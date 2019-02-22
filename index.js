'use strict';

const extend = require( 'extend' );
const get_request_ip = require( 'get-request-ip' );
const http = require( 'http' );
const httpstatuses = require( 'httpstatuses' );
const pkg = require( './package.json' );
const url = require( 'url' );

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
        const parsed_target = url.parse( _route.target );
        const route = extend( true, {}, _route, {
            _target: {
                hostname: parsed_target.hostname,
                port: parsed_target.port
            },
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

        http.createServer( async ( request, response ) => {

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
                const plugins = this.options.plugins.endpoints.concat( endpoint.plugins || [] );

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

            const proxied_request = http.request( {
                    hostname: route._target.hostname,
                    port: route._target.port,
                    method: request.method,
                    path: target_url,
                    headers: extend( true, {}, request.headers, {
                        'x-forwarded-for': get_request_ip( request ),
                        'x-micro-api-gateway': pkg.version
                    } )
                } )
                .on( 'error', error => {
                    console.log( 'proxied request error' );
                    console.dir( error );
                    if ( !!error && error.code === 'ECONNREFUSED' ) {
                        response.statusCode = httpstatuses.bad_gateway;
                        response.setHeader( 'Content-Type', 'application/json' );
                        response.end( JSON.stringify( {
                            error: 'connection refused',
                            message: 'The target connection was refused.'
                        } ) );
                    }
                    else {
                        response.statusCode = httpstatuses.internal_server_error;
                        response.end();
                    }
                } )
                .on( 'response', proxied_response => {
                    response.writeHead( proxied_response.statusCode, proxied_response.headers );
                    proxied_response.pipe( response );
                } );

            const route_options = {
                proxied_request,
                request,
                response
            };

            const plugins = this.options.plugins.routes.concat( route.plugins || [] );
            const stopped = await _process_plugins( plugins, route_options, request, response );

            if ( stopped ) {
                proxied_request.abort();
                return;
            }

            request.pipe( proxied_request );
        } )
        .on( 'error', error => {
            console.log( 'server error' );
            console.dir( error );
        } )
        .listen( options.port );
    }
};

module.exports = {
    create: function() {
        return Object.assign( {}, Gateway );
    }
};