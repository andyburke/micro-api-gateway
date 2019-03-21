'use strict';

const extend = require( 'extend' );
const jwt = require( 'jsonwebtoken' );

module.exports = function( _options ) {
    const options = extend( true, {
        name: 'jwt',
        request_field: 'tokens',
        algorithms: [ 'RS256' ],
        get_from_request: request => {
            return request.headers[ options.name ];
        },
        get_public_key: issuer => {
            return options.public_keys[ issuer ];
        },
        public_keys: {}
    }, _options );

    return async function( input ) {
        const token_string = await options.get_from_request( input.request );

        if ( !token_string ) {
            return;
        }

        const decoded = jwt.decode( token_string );
        const public_key = await options.get_public_key( decoded.iss );

        if ( !public_key ) {
            return;
        }

        try {
            const verified = jwt.verify( token_string, public_key, {
                algorithms: options.algorithms
            } );

            if ( !verified ) {
                return;
            }

            input.request[ options.request_field ] = input.request[ options.request_field ] || {};
            input.request[ options.request_field ][ options.name ] = verified;
        }
        catch( ex ) {

            if ( ex && ex.name === 'TokenExpiredError' ) {
                return;
            }

            return {
                error: ex.error || ex,
                message: ex.message || 'unknown'
            };
        }
    };
};