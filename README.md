# micro-api-gateway

A basic API gateway implementation.

## example

```javascript
const micro_api_gateway = require( 'micro-api-gateway' );
const url_matcher = require( 'url-matcher' );

const gateway = micro_api_gateway.create();

gateway.init( {
    // you can define your own URL matching, for example, you could use
    // url-matcher to support things like /users/:user_id
    matcher: path => {
        return {
            match: url => {
                return url_matcher.getParams( path, url );
            }
        };
    },

    // you can define endpoints on the API gateway itself, eg:
    endpoints: [ { 
        methods: [ 'GET' ],
        path: '/version', // get the API gateway version
        handler: ( request, response ) => {
            const pkg = require( './package.json' );
            response.setHeader( 'content-type', 'application/json' );
            response.statusCode = 200;
            response.end( JSON.stringify( {
                version: pkg.version
            } ) );
        }
    }, {
        methods: [ 'GET' ],
        path: '/public.pem', // expose a public key used for signing requests
        handler: ( request, response ) => {
            response.setHeader( 'Content-Type', 'application/x-pem-file' );
            response.statusCode = httpstatuses.ok;
            response.end( PUBLIC_KEY );
        } )
    } ],

    // you can define global plugins for both endpoints and routes
    plugins: {

        // define global endpoint plugins
        endpoints: {

            // execute these before any endpoint-specific plugins
            pre: [
                // log requests
                require( 'micro-api-gateway/plugins/log' )()
            ],

            // execute these after any endpoint-specific plugins
            post: [

            ]
        },

        // define route plugins
        routes: {

            // execute these before any route-specific plugins
            pre: [
                // log requests
                require( 'micro-api-gateway/plugins/log' )(),

                // read a JWT called 'auth' into the request field 'tokens',
                // eg: so that you can check request.tokens.auth to verify
                // that someone has sent a proper authentication JWT for your
                // systems
                require( 'micro-api-gateway/plugins/jwt' )( {
                    name: 'auth',
                    request_field: 'tokens',
                    public_key_endpoints: config.public_key_endpoints,
                    get_from_request: request => {
                        const cookies = cookie.parse( request.headers.cookie || '' );
                        return cookies.auth;
                    },
                    public_keys: {
                        'my.issuer': 'PUBLIC KEY....' // public key to verify JWTS from your issuing domain
                    }
                } ),

                // let's allow CORS-enabled cross-origin requests for requests
                // from our domain (you should probably be a bit more selective,
                // but this is just an example)
                require( 'micro-api-gateway/plugins/cors' )( {
                    origin: 'my.domain',
                    methods: [ 'OPTIONS', 'GET', 'POST', 'PUT', 'DELETE' ]
                } )
            ],

            // execute these after any route-specific plugins
            post: [
                // let's sign the requests we make to our internal services,
                // this will add the following headers to our internal requests:
                //   x-micro-api-gateway-request-hash
                //   x-micro-api-gateway-signature
                // which we can verify are coming from this API gateway
                require( 'micro-api-gateway/plugins/sign-requests' )( {
                    key: 'PRIVATE KEY',
                    headers_to_sign: [
                        'x-some-header-we-want-to-verify-on-incoming-requests',
                        'x-some-other-header-we-care-about'
                    ]
                } )
            ]
        }
    }
} );

// let's read our APIs from any files under the 'apis' directory
const APIs = require_dir( './apis' );
Object.keys( APIs ).forEach( api => {
    const routes = APIs[ api ];
    routes.forEach( route => {
        gateway.add_route( route );
    } );
} );

// let's start listening for requests
gateway.listen( {
    port: process.env.GATEWAY_PORT || 8000
} );
```