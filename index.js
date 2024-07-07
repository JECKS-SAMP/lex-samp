const dgram = require('dgram');
const decode = require('iconv-lite').decode;

const query = function (options, callback) {
    var self = this;

    if (typeof options === 'string') options.host = options;
    options.port = options.port || 7777;
    options.timeout = options.timeout || 5000; // Tingkatkan timeout menjadi 5000ms

    if (!options.host) return callback.apply(options, ['Invalid host']);

    if (
        !isFinite(options.port) ||
        options.port < 1 ||
        options.port > 65535
    )
        return callback.apply(options, ['Invalid port']);

    var response = {};
    var startTime = new Date().getTime();

    request.call(self, options, 'i', function (error, information) {
        if (error) return callback.apply(options, [error]);

        response.address = options.host;
        response.hostname = information.hostname;
        response.gamemode = information.gamemode;
        response.mapname = information.mapname;
        response.passworded = information.passworded === 1;
        response.maxplayers = information.maxplayers;
        response.online = information.players;

        request.call(self, options, 'r', function (error, rules) {
            if (error) return callback.apply(options, [error]);

            rules.lagcomp = rules.lagcomp === 'On';
            rules.weather = parseInt(rules.weather, 10);

            response.rules = rules;

            if (response.online > 100) {
                response.players = [];
                var endTime = new Date().getTime();
                response.ping = endTime - startTime;
                return callback.apply(options, [false, response]);
            } else {
                request.call(self, options, 'd', function (error, players) {
                    if (error) return callback.apply(options, [error]);

                    response.players = players;
                    var endTime = new Date().getTime();
                    response.ping = endTime - startTime;
                    return callback.apply(options, [false, response]);
                });
            }
        });
    });
};

const request = function (options, opcode, callback) {
    const socket = dgram.createSocket("udp4");
    const packet = Buffer.alloc(11);

    packet.write('SAMP');

    const hostParts = options.host.split('.').map(Number);
    if (hostParts.length !== 4) {
        return callback.apply(options, [new Error('Invalid host format')]);
    }

    for (var i = 0; i < 4; ++i) {
        packet[i + 4] = hostParts[i];
    }
    packet[8] = options.port & 0xFF;
    packet[9] = (options.port >> 8) & 0xFF;
    packet[10] = opcode.charCodeAt(0);

    console.log(`Sending packet to ${options.host}:${options.port} with opcode ${opcode}`);

    try {
        socket.send(packet, 0, packet.length, options.port, options.host, function (error, bytes) {
            if (error) {
                console.log(`Error sending packet: ${error}`);
                return callback(error);
            }
            console.log(`Packet sent, ${bytes} bytes`);
        });
    } catch (error) {
        console.log(`Exception during socket send: ${error}`);
        return callback(error);
    }

    var controller = setTimeout(function () {
        socket.close();
        console.log('Request timed out');
        return callback('Host unavailable');
    }, options.timeout);

    socket.on('message', function (message) {
        clearTimeout(controller);
        socket.close();

        if (message.length < 11) return callback.apply(options, [true]);

        message = message.slice(11);
        var object = {};
        var array = [];
        var strlen = 0;
        var offset = 0;

        try {
            if (opcode == 'i') {
                object.passworded = message.readUInt8(offset);
                offset += 1;
                object.players = message.readUInt16LE(offset);
                offset += 2;
                object.maxplayers = message.readUInt16LE(offset);
                offset += 2;
                strlen = message.readUInt16LE(offset);
                offset += 4;
                object.hostname = decode(message.slice(offset, offset += strlen));
                strlen = message.readUInt16LE(offset);
                offset += 4;
                object.gamemode = decode(message.slice(offset, offset += strlen));
                strlen = message.readUInt16LE(offset);
                offset += 4;
                object.mapname = decode(message.slice(offset, offset += strlen));
                return callback.apply(options, [false, object]);
            }

            if (opcode == 'r') {
                var rulecount = message.readUInt16LE(offset);
                offset += 2;
                var property, value;
                while (rulecount) {
                    strlen = message.readUInt8(offset);
                    ++offset;
                    property = decode(message.slice(offset, offset += strlen));
                    strlen = message.readUInt8(offset);
                    ++offset;
                    value = decode(message.slice(offset, offset += strlen));
                    object[property] = value;
                    --rulecount;
                }
                return callback.apply(options, [false, object]);
            }

            if (opcode == 'd') {
                var playercount = message.readUInt16LE(offset);
                offset += 2;
                var player;
                while (playercount) {
                    player = {};
                    player.id = message.readUInt8(offset);
                    ++offset;
                    strlen = message.readUInt8(offset);
                    ++offset;
                    player.name = decode(message.slice(offset, offset += strlen));
                    player.score = message.readUInt16LE(offset);
                    offset += 4;
                    player.ping = message.readUInt16LE(offset);
                    offset += 4;
                    array.push(player);
                    --playercount;
                }
                return callback.apply(options, [false, array]);
            }
        } catch (exception) {
            console.log('Exception during parsing:', exception);
            return callback.apply(options, [exception]);
        }
    });

    socket.on('error', function (err) {
        clearTimeout(controller);
        socket.close();
        console.log(`Socket error: ${err}`);
        return callback.apply(options, [err]);
    });
};

module.exports = query;
