'use strict';

const extend = require( 'extend' );
const get_request_ip = require( 'get-request-ip' );
const readable_size = require( 'readable-size' );

module.exports = function( _options ) {
    const options = extend( true, {
        formatter: log_entry => {
            return `=><= ${ log_entry.created_at.toISOString() } ${ log_entry.ip } ${ log_entry.version } ${ log_entry.protocol } ${ log_entry.method } ${ log_entry.path }${ log_entry.target ? ` => ${ `${ log_entry.target }${ log_entry.target_url }` }` : '' } ${ log_entry.status } ${ readable_size( log_entry.size, { output: 'string', format: '{{size}}{{unit}}' } ) } ${ log_entry.time }ms ${ log_entry.closed ? 'CLOSED' : '' }`;
        }
    }, _options );

    return async function( input ) {
        const log_entry = {
            ip: get_request_ip( input.request ),
            version: `HTTP/${ input.request.httpVersion }`,
            protocol: `HTTP${ input.request.connection.encrypted ? 'S' : '' }`,
            agent: input.request.headers[ 'user-agent' ] || 'unknown',
            referrer: input.request.headers.referer || input.request.headers.referrer,
            created_at: new Date(),
            completed_at: null,
            time: 0,
            method: input.request.method,
            path: input.request.url,
            target: input.target,
            target_url: input.target_url,
            status: 0,
            size: 0,
            finished: false,
            closed: false
        };

        const request_socket = ( input.request.socket && input.request.socket.socket ) ? input.request.socket.socket : input.request.socket;
        const initial_bytes_written = request_socket.bytesWritten || 0;

        function on_done() {
            log_entry.completed_at = new Date();
            log_entry.time = log_entry.completed_at - log_entry.created_at;
            log_entry.size = ( request_socket.bytesWritten || 0 ) - initial_bytes_written;
        }

        function on_close() {
            on_done();

            log_entry.status = input.response.statusCode || 500;
            log_entry.closed = true;

            console.log( options.formatter( log_entry ) );
        }

        function on_finish() {
            input.response.removeListener( 'close', on_close );

            on_done();

            log_entry.status = input.response.statusCode || 500;
            log_entry.finished = true;

            console.log( options.formatter( log_entry ) );
        }

        input.response.once( 'close', on_close );
        input.response.once( 'finish', on_finish );
    };
};