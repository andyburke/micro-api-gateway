'use strict';

const extend = require( 'extend' );
const get_request_ip = require( 'get-request-ip' );
const http = require( 'http' );
const https = require( 'https' );
const httpstatuses = require( 'httpstatuses' );
const pkg = require( './package.json' );
const url = require( 'url' );

function log( str ) {
    if ( !process.env.GATEWAY_LOGGING ) {
        return;
    }

    console.log( str );
}

function log_request( request ) {
    if ( !process.env.GATEWAY_LOGGING ) {
        return;
    }

    const fields = [];
    fields.push( ( ( request.start && new Date( request.start ) ) || new Date() ).toISOString() );
    fields.push( `HTTP/${ request.httpVersion }` );
    fields.push( get_request_ip( request ) );
    fields.push( request.method );
    fields.push( request.url );
    fields.push( `"${ request.headers[ 'user-agent' ] || '-' }"` );
    fields.push( `"${ request.headers.referer || '-' }"` );
    console.log( fields.join( ' ' ) );
}

async function _process_plugins( plugins, options, request, response ) {
    let stopped = false;

    for ( const plugin of plugins ) {
        const result = await plugin( options );

        if ( !!result && result.headers ) {
            Object.keys( result.headers ).forEach( header => {
                response.setHeader( header, result.headers[ header ] );
            } );
        }

        if ( !!result && result.error ) {
            response.statusCode = result.status || httpstatuses.internal_server_error;
            if ( result.body ) {
                response.end( result.body );
            }
            else {
                response.setHeader( 'Content-Type', 'application/json' );
                try {
                    response.end( JSON.stringify( result ) );
                }
                catch ( ex ) {
                    response.end( JSON.stringify( {
                        error: 'unknown error'
                    } ) );
                }
            }
            stopped = true;
            break;
        }

        if ( !!result && result.status ) {
            response.statusCode = result.status;
            response.end( typeof result.body !== 'undefined' ? result.body : 'Error processing request.' );
            stopped = true;
            break;
        }
    }

    return stopped;
}

const Gateway = {
    init: function( _options ) {
        this.options = extend( true, {
            endpoints: [],
            routes: [],
            matcher: path => {
                return {
                    match: url => {
                        return url === path ? {} : undefined;
                    }
                };
            },
            plugins: {
                endpoints: [],
                routes: []
            }
        }, _options );

        this.options.endpoints.forEach( endpoint => {
            this.add_endpoint( endpoint );
        } );

        this.options.routes.forEach( route => {
            this.add_route( route );
        } );

        return this;
    },

    add_endpoint: function( _endpoint ) {
        const endpoint = extend( true, {}, _endpoint, {
            _matcher: _endpoint.matcher || this.options.matcher( _endpoint.path )
        } );

        this.endpoints = this.endpoints || [];
        this.endpoints.push( endpoint );
    },

    add_route: function( _route ) {
        const route = extend( true, {}, _route, {
            _target: url.parse( _route.target ),
            _matcher: _route.matcher || this.options.matcher( _route.path )
        } );

        this.routes = this.routes || [];
        this.routes.push( route );

        return this;
    },

    listen: function( _options ) {
        const options = extend( true, {
            port: 8000
        }, _options );

        const proxy_server = http.createServer( async ( request, response ) => {
            log_request( request );

            let target_url = null;

            request.on( 'error', error => {
                console.log( 'request error' );
                console.dir( error );
                if ( request.socket && request.socket.destroyed && error.code === 'ECONNRESET' ) {
                    request.abort();
                }
            } );

            response.on( 'error', error => {
                console.log( 'response error' );
                console.dir( error );
            } );

            const endpoint = this.endpoints.find( _endpoint => {
                const is_correct_method = _endpoint.methods.includes( '*' ) || _endpoint.methods.includes( request.method );
                target_url = request.url;
                return is_correct_method && !!( request.params = _endpoint._matcher.match( target_url ) );
            } );

            if ( endpoint ) {
                log( `endpoint match: ${ JSON.stringify( endpoint.methods ) } ${ endpoint.path }` );

                const endpoint_plugins = extend( true, {
                    pre: [],
                    post: []
                }, this.options.plugins.endpoints );
                const plugins = [ ...endpoint_plugins.pre, ...( endpoint.plugins || [] ), ...endpoint_plugins.post ];
    
                const stopped = await _process_plugins( plugins, {
                    request,
                    response
                }, request, response );

                if ( stopped ) {
                    return;
                }

                await endpoint.handler( request, response );
                return;
            }

            const route = this.routes.find( route => {
                const is_correct_method = route.methods.includes( '*' ) || route.methods.includes( request.method );
                const is_correct_mount = route.mount ? request.url.indexOf( route.mount ) === 0 : true;
                target_url = is_correct_mount ? ( route.mount ? request.url.substr( route.mount.length ) : request.url ) : null;
                return is_correct_method && is_correct_mount && !!( request.params = route._matcher.match( target_url ) );
            } );

            if ( !route ) {
                response.statusCode = httpstatuses.not_found;
                response.setHeader( 'Content-Type', 'application/json' );
                response.end( '{ "error": "not found" }' );
                return;
            }

            // TODO: allow for a target_path on a route, rewriting in the matched params, etc.
            const proxied_url = `${ route.target }${ target_url }`;

            log( `route match: ${ JSON.stringify( route.methods ) } ${ route.mount } ${ route.path } => (${ route._target.protocol }) ${ proxied_url }` );

            // const headers = extend( true, {}, request.headers, {
            //     'connection': 'keep-alive',
            //     'x-forwarded-for': get_request_ip( request ),
            //     'x-micro-api-gateway': pkg.version
            // } );
            // delete headers.host; // clear host header, as it should be set in the proxied request

            // log( JSON.stringify( headers, null, 4 ) );

            const proxied_request = ( route._target.protocol === 'https:' ? https : http ).request( proxied_url, {
                method: request.method,
                headers: {
                    'x-forwarded-for': get_request_ip( request ),
                    'x-micro-api-gateway': pkg.version
                }
            } );

            proxied_request.on( 'error', error => {
                // nothing to be done if the response is already done
                if ( response.finished ) {
                    return;
                }

                if ( !!error && error.code === 'ECONNRESET' ) {
                    response.statusCode = httpstatuses.bad_gateway;
                    response.setHeader( 'Content-Type', 'application/json' );
                    response.end( JSON.stringify( {
                        error: 'connection reset',
                        message: 'The target connection was reset.'
                    } ) );
                }
                else if ( !!error && error.code === 'ECONNREFUSED' ) {
                    response.statusCode = httpstatuses.bad_gateway;
                    response.setHeader( 'Content-Type', 'application/json' );
                    response.end( JSON.stringify( {
                        error: 'connection refused',
                        message: 'The target connection was refused.'
                    } ) );
                }
                else {
                    response.statusCode = httpstatuses.internal_server_error;
                    response.setHeader( 'Content-Type', 'application/json' );
                    response.end( JSON.stringify( {
                        error: 'unknown error',
                        code: error.code || null,
                        message: error.message || 'Unknown error.',
                        stack: error.stack || null
                    } ) );
                    response.end();
                }
            } );

            proxied_request.on( 'response', proxied_response => {
                if ( !response.finished ) {
                    response.writeHead( proxied_response.statusCode, proxied_response.headers );
                    proxied_response.pipe( response );
                }
            } );

            request.on( 'abort', () => {
                proxied_request.abort();
            } );

            const route_options = {
                target: route.target,
                target_url,
                proxied_request,
                request,
                response
            };

            const route_plugins = extend( true, {
                pre: [],
                post: []
            }, this.options.plugins.routes );
            const plugins = [ ...route_plugins.pre, ...( route.plugins || [] ), ...route_plugins.post ];
            const stopped = await _process_plugins( plugins, route_options, request, response );

            if ( stopped ) {
                proxied_request.abort();
                return;
            }

            request.pipe( proxied_request );
        } );

        proxy_server.on( 'error', error => {
            console.log( 'server error' );
            console.dir( error );
        } );

        proxy_server.listen( options.port );
    }
};

module.exports = {
    create: function() {
        return Object.assign( {}, Gateway );
    }
};