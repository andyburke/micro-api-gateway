'use strict';

const crypto = require( 'crypto' );
const extend = require( 'extend' );
const json_stable_stringify = require( 'json-stable-stringify' );

module.exports = function( _options ) {
    const options = extend( true, {}, _options );

    return async function( input ) {

        input.proxied_request.setHeader( 'x-micro-api-gateway-signature-time', `${ +new Date() }` );

        const request_as_string = [ input.proxied_request.method, input.proxied_request.path, json_stable_stringify( input.proxied_request.getHeaders() ) ].join( ':::' );
        console.log( request_as_string );
        const request_hash = crypto.createHash( 'SHA256' ).update( request_as_string ).digest( 'base64' );
        const request_hash_signature = crypto.createSign( 'RSA-SHA256' ).update( request_hash ).sign( options.key, 'base64' );

        input.proxied_request.setHeader( 'x-micro-api-gateway-request-hash',  request_hash );
        input.proxied_request.setHeader( 'x-micro-api-gateway-signature', request_hash_signature );
    }
};