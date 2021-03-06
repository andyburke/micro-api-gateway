'use strict';

const crypto = require( 'crypto' );
const extend = require( 'extend' );
const json_stable_stringify = require( 'json-stable-stringify' );

module.exports = function( _options ) {
    const options = extend( true, {
        headers_to_sign: []
    }, _options );

    return async function( input ) {

        input.proxied_request.setHeader( 'x-micro-api-gateway-signature-time', `${ +new Date() }` );

        const request_headers = extend( true, {}, input.proxied_request.getHeaders() );
        const headers_to_sign = options.headers_to_sign.reduce( ( _headers_to_sign, header ) => {
            if ( typeof request_headers[ header ] !== 'undefined' ) {
                _headers_to_sign[ header ] = request_headers[ header ];
            }
            return _headers_to_sign;
        }, {} );

        const request_as_string = [ input.proxied_request.method, input.proxied_request.path, json_stable_stringify( headers_to_sign ) ].join( ':::' );
        const request_hash = crypto.createHash( 'SHA256' ).update( request_as_string ).digest( 'base64' );
        const request_hash_signature = crypto.createSign( 'RSA-SHA256' ).update( request_hash ).sign( options.key, 'base64' );

        if ( process.env.API_GATEWAY_DEBUG ) {
            console.log( `REQ: ${ request_as_string }` );
            console.log( `HASH: ${ request_hash }` );
            console.log( `HASH_SIG: ${ request_hash_signature }` );
        }

        input.proxied_request.setHeader( 'x-micro-api-gateway-request-hash',  request_hash );
        input.proxied_request.setHeader( 'x-micro-api-gateway-signature', request_hash_signature );
    };
};