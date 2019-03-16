'use strict';

const corsable = require( 'corsable' );

module.exports = function( options ) {
    const cors = corsable.bind( null, options );

    return async function( input ) {
        cors( input.request, input.response );
    };
};
