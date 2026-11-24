/*eslint-disable block-scoped-var, id-length, no-control-regex, no-magic-numbers, no-mixed-operators, no-prototype-builtins, no-redeclare, no-shadow, no-var, sort-vars, default-case, jsdoc/require-param*/
import $protobuf from "protobufjs/minimal.js";

const $Reader = $protobuf.Reader, $Writer = $protobuf.Writer, $util = $protobuf.util;
const $Object = $util.global.Object, $undefined = $util.global.undefined, $Error = $util.global.Error, $RangeError = $util.global.RangeError, $Array = $util.global.Array, $TypeError = $util.global.TypeError, $Number = $util.global.Number, $parseInt = $util.global.parseInt, $Boolean = $util.global.Boolean, $String = $util.global.String, $BigInt = $util.global.BigInt, $isFinite = $util.global.isFinite;

const $root = $protobuf.roots["default"] || ($protobuf.roots["default"] = {});

export const MumbleUDP = $root.MumbleUDP = (() => {

    const MumbleUDP = {};

    MumbleUDP.Audio = (function() {

        const Audio = function (properties) {
            this.positional_data = [];
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        Audio.prototype.target = null;
        Audio.prototype.context = null;
        Audio.prototype.sender_session = 0;
        Audio.prototype.frame_number = $util.Long ? $util.Long.fromBits(0,0,true) : 0;
        Audio.prototype.opus_data = $util.newBuffer([]);
        Audio.prototype.positional_data = $util.emptyArray;
        Audio.prototype.volume_adjustment = 0;
        Audio.prototype.is_terminator = false;

        let $oneOfFields;

        $Object.defineProperty(Audio.prototype, "Header", {
            get: $util.oneOfGetter($oneOfFields = ["target", "context"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        Audio.create = function(properties) {
            return new Audio(properties);
        };

        Audio.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.target != null && $Object.hasOwnProperty.call(message, "target"))
                writer.uint32(8).uint32(message.target);
            if (message.context != null && $Object.hasOwnProperty.call(message, "context"))
                writer.uint32(16).uint32(message.context);
            if (message.sender_session != null && $Object.hasOwnProperty.call(message, "sender_session") && message.sender_session !== 0)
                writer.uint32(24).uint32(message.sender_session);
            if (message.frame_number != null && $Object.hasOwnProperty.call(message, "frame_number") && (typeof message.frame_number === "object" ? message.frame_number.low || message.frame_number.high : message.frame_number !== 0))
                writer.uint32(32).uint64(message.frame_number);
            if (message.opus_data != null && $Object.hasOwnProperty.call(message, "opus_data") && message.opus_data.length)
                writer.uint32(42).bytes(message.opus_data);
            if (message.positional_data != null && message.positional_data.length)
                writer.uint32(50).floats(message.positional_data);
            if (message.volume_adjustment != null && $Object.hasOwnProperty.call(message, "volume_adjustment") && !$Object.is(message.volume_adjustment, 0))
                writer.uint32(61).float(message.volume_adjustment);
            if (message.is_terminator != null && $Object.hasOwnProperty.call(message, "is_terminator") && message.is_terminator !== false)
                writer.uint32(128).bool(message.is_terminator);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        Audio.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end, message, value;
            if (length === $undefined)
                end = reader.len;
            else {
                end = reader.pos + length;
                if (end > reader.len)
                    throw $RangeError("index out of range");
                length = reader.len;
                reader.len = end;
            }
            message = _target || new $root.MumbleUDP.Audio();
            while (reader.pos < end) {
                let start = reader.pos;
                let tag = reader.tag();
                if (tag === _end) {
                    _end = $undefined;
                    break;
                }
                let wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 0)
                            break;
                        message.target = reader.uint32();
                        message.Header = "target";
                        continue;
                    }
                case 2: {
                        if (wireType !== 0)
                            break;
                        message.context = reader.uint32();
                        message.Header = "context";
                        continue;
                    }
                case 3: {
                        if (wireType !== 0)
                            break;
                        if (value = reader.uint32())
                            message.sender_session = value;
                        else
                            delete message.sender_session;
                        continue;
                    }
                case 4: {
                        if (wireType !== 0)
                            break;
                        if (typeof (value = reader.uint64()) === "object" ? value.low || value.high : value !== 0)
                            message.frame_number = value;
                        else
                            delete message.frame_number;
                        continue;
                    }
                case 5: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.bytes()).length)
                            message.opus_data = value;
                        else
                            delete message.opus_data;
                        continue;
                    }
                case 6: {
                        if (wireType === 2) {
                            if (!(message.positional_data && message.positional_data.length))
                                message.positional_data = [];
                            reader.floats(message.positional_data);
                            continue;
                        }
                        if (wireType !== 5)
                            break;
                        if (!(message.positional_data && message.positional_data.length))
                            message.positional_data = [];
                        message.positional_data.push(reader.float());
                        continue;
                    }
                case 7: {
                        if (wireType !== 5)
                            break;
                        if (!$Object.is(value = reader.float(), 0))
                            message.volume_adjustment = value;
                        else
                            delete message.volume_adjustment;
                        continue;
                    }
                case 16: {
                        if (wireType !== 0)
                            break;
                        if (value = reader.bool())
                            message.is_terminator = value;
                        else
                            delete message.is_terminator;
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                if (!reader.discardUnknown) {
                    $util.makeProp(message, "$unknowns", false);
                    (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                }
            }
            if (length !== $undefined) {
                if (reader.pos !== end)
                    throw $RangeError("index out of range");
                reader.len = length;
            }
            if (_end !== $undefined)
                throw $Error("missing end group");
            return message;
        };

        Audio.verify = function (message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            let properties = {};
            if (message.target != null && $Object.hasOwnProperty.call(message, "target")) {
                properties.Header = 1;
                if (!$util.isInteger(message.target))
                    return "target: integer expected";
            }
            if (message.context != null && $Object.hasOwnProperty.call(message, "context")) {
                if (properties.Header === 1)
                    return "Header: multiple values";
                properties.Header = 1;
                if (!$util.isInteger(message.context))
                    return "context: integer expected";
            }
            if (message.sender_session != null && $Object.hasOwnProperty.call(message, "sender_session"))
                if (!$util.isInteger(message.sender_session))
                    return "sender_session: integer expected";
            if (message.frame_number != null && $Object.hasOwnProperty.call(message, "frame_number"))
                if (!$util.isInteger(message.frame_number) && !(message.frame_number && $util.isInteger(message.frame_number.low) && $util.isInteger(message.frame_number.high)))
                    return "frame_number: integer|Long expected";
            if (message.opus_data != null && $Object.hasOwnProperty.call(message, "opus_data"))
                if (!(message.opus_data && typeof message.opus_data.length === "number" || $util.isString(message.opus_data)))
                    return "opus_data: buffer expected";
            if (message.positional_data != null && $Object.hasOwnProperty.call(message, "positional_data")) {
                if (!$Array.isArray(message.positional_data))
                    return "positional_data: array expected";
                for (let i = 0; i < message.positional_data.length; ++i)
                    if (typeof message.positional_data[i] !== "number")
                        return "positional_data: number[] expected";
            }
            if (message.volume_adjustment != null && $Object.hasOwnProperty.call(message, "volume_adjustment"))
                if (typeof message.volume_adjustment !== "number")
                    return "volume_adjustment: number expected";
            if (message.is_terminator != null && $Object.hasOwnProperty.call(message, "is_terminator"))
                if (typeof message.is_terminator !== "boolean")
                    return "is_terminator: boolean expected";
            return null;
        };

        Audio.fromObject = function (object, _depth) {
            if (object instanceof $root.MumbleUDP.Audio)
                return object;
            if (!$util.isObject(object))
                throw $TypeError(".MumbleUDP.Audio: object expected");
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let message = new $root.MumbleUDP.Audio();
            if (object.target != null)
                message.target = object.target >>> 0;
            if (object.context != null)
                message.context = object.context >>> 0;
            if (object.sender_session != null)
                if ($Number(object.sender_session) !== 0)
                    message.sender_session = object.sender_session >>> 0;
            if (object.frame_number != null)
                if (typeof object.frame_number === "object" ? object.frame_number.low || object.frame_number.high : $Number(object.frame_number) !== 0)
                    if ($util.Long)
                        message.frame_number = $util.Long.fromValue(object.frame_number, true);
                    else if (typeof object.frame_number === "string")
                        message.frame_number = $parseInt(object.frame_number, 10);
                    else if (typeof object.frame_number === "number")
                        message.frame_number = object.frame_number;
                    else if (typeof object.frame_number === "object")
                        message.frame_number = new $util.LongBits(object.frame_number.low >>> 0, object.frame_number.high >>> 0).toNumber(true);
            if (object.opus_data != null)
                if (object.opus_data.length)
                    if (typeof object.opus_data === "string")
                        $util.base64.decode(object.opus_data, message.opus_data = $util.newBuffer($util.base64.length(object.opus_data)), 0);
                    else if (object.opus_data.length >= 0)
                        message.opus_data = object.opus_data;
            if (object.positional_data) {
                if (!$Array.isArray(object.positional_data))
                    throw $TypeError(".MumbleUDP.Audio.positional_data: array expected");
                message.positional_data = $Array(object.positional_data.length);
                for (let i = 0; i < object.positional_data.length; ++i)
                    message.positional_data[i] = $Number(object.positional_data[i]);
            }
            if (object.volume_adjustment != null)
                if (!$Object.is($Number(object.volume_adjustment), 0))
                    message.volume_adjustment = $Number(object.volume_adjustment);
            if (object.is_terminator != null)
                if (object.is_terminator)
                    message.is_terminator = $Boolean(object.is_terminator);
            return message;
        };

        Audio.toObject = function (message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let object = {};
            if (options.arrays || options.defaults)
                object.positional_data = [];
            if (options.defaults) {
                object.sender_session = 0;
                if ($util.Long) {
                    let long = new $util.Long(0, 0, true);
                    object.frame_number = options.longs === $String ? long.toString() : options.longs === $Number ? long.toNumber() : typeof $BigInt !== "undefined" && options.longs === $BigInt ? long.toBigInt() : long;
                } else
                    object.frame_number = options.longs === $String ? "0" : typeof $BigInt !== "undefined" && options.longs === $BigInt ? $BigInt("0") : 0;
                if (options.bytes === $String)
                    object.opus_data = "";
                else {
                    object.opus_data = [];
                    if (options.bytes !== $Array)
                        object.opus_data = $util.newBuffer(object.opus_data);
                }
                object.volume_adjustment = 0;
                object.is_terminator = false;
            }
            if (message.target != null && $Object.hasOwnProperty.call(message, "target")) {
                object.target = message.target;
                if (options.oneofs)
                    object.Header = "target";
            }
            if (message.context != null && $Object.hasOwnProperty.call(message, "context")) {
                object.context = message.context;
                if (options.oneofs)
                    object.Header = "context";
            }
            if (message.sender_session != null && $Object.hasOwnProperty.call(message, "sender_session"))
                object.sender_session = message.sender_session;
            if (message.frame_number != null && $Object.hasOwnProperty.call(message, "frame_number"))
                if (typeof $BigInt !== "undefined" && options.longs === $BigInt)
                    object.frame_number = typeof message.frame_number === "number" ? $BigInt(message.frame_number) : $util.Long.fromBits(message.frame_number.low >>> 0, message.frame_number.high >>> 0, true).toBigInt();
                else if (typeof message.frame_number === "number")
                    object.frame_number = options.longs === $String ? $String(message.frame_number) : message.frame_number;
                else
                    object.frame_number = options.longs === $String ? $util.Long.prototype.toString.call(message.frame_number) : options.longs === $Number ? new $util.LongBits(message.frame_number.low >>> 0, message.frame_number.high >>> 0).toNumber(true) : message.frame_number;
            if (message.opus_data != null && $Object.hasOwnProperty.call(message, "opus_data"))
                object.opus_data = options.bytes === $String ? $util.base64.encode(message.opus_data, 0, message.opus_data.length) : options.bytes === $Array ? $Array.prototype.slice.call(message.opus_data) : message.opus_data;
            if (message.positional_data && message.positional_data.length) {
                object.positional_data = $Array(message.positional_data.length);
                for (let j = 0; j < message.positional_data.length; ++j)
                    object.positional_data[j] = options.json && !$isFinite(message.positional_data[j]) ? $String(message.positional_data[j]) : message.positional_data[j];
            }
            if (message.volume_adjustment != null && $Object.hasOwnProperty.call(message, "volume_adjustment"))
                object.volume_adjustment = options.json && !$isFinite(message.volume_adjustment) ? $String(message.volume_adjustment) : message.volume_adjustment;
            if (message.is_terminator != null && $Object.hasOwnProperty.call(message, "is_terminator"))
                object.is_terminator = message.is_terminator;
            return object;
        };

        Audio.prototype.toJSON = function() {
            return Audio.toObject(this, $protobuf.util.toJSONOptions);
        };

        Audio.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/MumbleUDP.Audio";
        };

        return Audio;
    })();

    MumbleUDP.Ping = (function() {

        const Ping = function (properties) {
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        Ping.prototype.timestamp = $util.Long ? $util.Long.fromBits(0,0,true) : 0;
        Ping.prototype.request_extended_information = false;
        Ping.prototype.server_version_v2 = $util.Long ? $util.Long.fromBits(0,0,true) : 0;
        Ping.prototype.user_count = 0;
        Ping.prototype.max_user_count = 0;
        Ping.prototype.max_bandwidth_per_user = 0;

        Ping.create = function(properties) {
            return new Ping(properties);
        };

        Ping.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.timestamp != null && $Object.hasOwnProperty.call(message, "timestamp") && (typeof message.timestamp === "object" ? message.timestamp.low || message.timestamp.high : message.timestamp !== 0))
                writer.uint32(8).uint64(message.timestamp);
            if (message.request_extended_information != null && $Object.hasOwnProperty.call(message, "request_extended_information") && message.request_extended_information !== false)
                writer.uint32(16).bool(message.request_extended_information);
            if (message.server_version_v2 != null && $Object.hasOwnProperty.call(message, "server_version_v2") && (typeof message.server_version_v2 === "object" ? message.server_version_v2.low || message.server_version_v2.high : message.server_version_v2 !== 0))
                writer.uint32(24).uint64(message.server_version_v2);
            if (message.user_count != null && $Object.hasOwnProperty.call(message, "user_count") && message.user_count !== 0)
                writer.uint32(32).uint32(message.user_count);
            if (message.max_user_count != null && $Object.hasOwnProperty.call(message, "max_user_count") && message.max_user_count !== 0)
                writer.uint32(40).uint32(message.max_user_count);
            if (message.max_bandwidth_per_user != null && $Object.hasOwnProperty.call(message, "max_bandwidth_per_user") && message.max_bandwidth_per_user !== 0)
                writer.uint32(48).uint32(message.max_bandwidth_per_user);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        Ping.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end, message, value;
            if (length === $undefined)
                end = reader.len;
            else {
                end = reader.pos + length;
                if (end > reader.len)
                    throw $RangeError("index out of range");
                length = reader.len;
                reader.len = end;
            }
            message = _target || new $root.MumbleUDP.Ping();
            while (reader.pos < end) {
                let start = reader.pos;
                let tag = reader.tag();
                if (tag === _end) {
                    _end = $undefined;
                    break;
                }
                let wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 0)
                            break;
                        if (typeof (value = reader.uint64()) === "object" ? value.low || value.high : value !== 0)
                            message.timestamp = value;
                        else
                            delete message.timestamp;
                        continue;
                    }
                case 2: {
                        if (wireType !== 0)
                            break;
                        if (value = reader.bool())
                            message.request_extended_information = value;
                        else
                            delete message.request_extended_information;
                        continue;
                    }
                case 3: {
                        if (wireType !== 0)
                            break;
                        if (typeof (value = reader.uint64()) === "object" ? value.low || value.high : value !== 0)
                            message.server_version_v2 = value;
                        else
                            delete message.server_version_v2;
                        continue;
                    }
                case 4: {
                        if (wireType !== 0)
                            break;
                        if (value = reader.uint32())
                            message.user_count = value;
                        else
                            delete message.user_count;
                        continue;
                    }
                case 5: {
                        if (wireType !== 0)
                            break;
                        if (value = reader.uint32())
                            message.max_user_count = value;
                        else
                            delete message.max_user_count;
                        continue;
                    }
                case 6: {
                        if (wireType !== 0)
                            break;
                        if (value = reader.uint32())
                            message.max_bandwidth_per_user = value;
                        else
                            delete message.max_bandwidth_per_user;
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                if (!reader.discardUnknown) {
                    $util.makeProp(message, "$unknowns", false);
                    (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                }
            }
            if (length !== $undefined) {
                if (reader.pos !== end)
                    throw $RangeError("index out of range");
                reader.len = length;
            }
            if (_end !== $undefined)
                throw $Error("missing end group");
            return message;
        };

        Ping.verify = function (message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (message.timestamp != null && $Object.hasOwnProperty.call(message, "timestamp"))
                if (!$util.isInteger(message.timestamp) && !(message.timestamp && $util.isInteger(message.timestamp.low) && $util.isInteger(message.timestamp.high)))
                    return "timestamp: integer|Long expected";
            if (message.request_extended_information != null && $Object.hasOwnProperty.call(message, "request_extended_information"))
                if (typeof message.request_extended_information !== "boolean")
                    return "request_extended_information: boolean expected";
            if (message.server_version_v2 != null && $Object.hasOwnProperty.call(message, "server_version_v2"))
                if (!$util.isInteger(message.server_version_v2) && !(message.server_version_v2 && $util.isInteger(message.server_version_v2.low) && $util.isInteger(message.server_version_v2.high)))
                    return "server_version_v2: integer|Long expected";
            if (message.user_count != null && $Object.hasOwnProperty.call(message, "user_count"))
                if (!$util.isInteger(message.user_count))
                    return "user_count: integer expected";
            if (message.max_user_count != null && $Object.hasOwnProperty.call(message, "max_user_count"))
                if (!$util.isInteger(message.max_user_count))
                    return "max_user_count: integer expected";
            if (message.max_bandwidth_per_user != null && $Object.hasOwnProperty.call(message, "max_bandwidth_per_user"))
                if (!$util.isInteger(message.max_bandwidth_per_user))
                    return "max_bandwidth_per_user: integer expected";
            return null;
        };

        Ping.fromObject = function (object, _depth) {
            if (object instanceof $root.MumbleUDP.Ping)
                return object;
            if (!$util.isObject(object))
                throw $TypeError(".MumbleUDP.Ping: object expected");
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let message = new $root.MumbleUDP.Ping();
            if (object.timestamp != null)
                if (typeof object.timestamp === "object" ? object.timestamp.low || object.timestamp.high : $Number(object.timestamp) !== 0)
                    if ($util.Long)
                        message.timestamp = $util.Long.fromValue(object.timestamp, true);
                    else if (typeof object.timestamp === "string")
                        message.timestamp = $parseInt(object.timestamp, 10);
                    else if (typeof object.timestamp === "number")
                        message.timestamp = object.timestamp;
                    else if (typeof object.timestamp === "object")
                        message.timestamp = new $util.LongBits(object.timestamp.low >>> 0, object.timestamp.high >>> 0).toNumber(true);
            if (object.request_extended_information != null)
                if (object.request_extended_information)
                    message.request_extended_information = $Boolean(object.request_extended_information);
            if (object.server_version_v2 != null)
                if (typeof object.server_version_v2 === "object" ? object.server_version_v2.low || object.server_version_v2.high : $Number(object.server_version_v2) !== 0)
                    if ($util.Long)
                        message.server_version_v2 = $util.Long.fromValue(object.server_version_v2, true);
                    else if (typeof object.server_version_v2 === "string")
                        message.server_version_v2 = $parseInt(object.server_version_v2, 10);
                    else if (typeof object.server_version_v2 === "number")
                        message.server_version_v2 = object.server_version_v2;
                    else if (typeof object.server_version_v2 === "object")
                        message.server_version_v2 = new $util.LongBits(object.server_version_v2.low >>> 0, object.server_version_v2.high >>> 0).toNumber(true);
            if (object.user_count != null)
                if ($Number(object.user_count) !== 0)
                    message.user_count = object.user_count >>> 0;
            if (object.max_user_count != null)
                if ($Number(object.max_user_count) !== 0)
                    message.max_user_count = object.max_user_count >>> 0;
            if (object.max_bandwidth_per_user != null)
                if ($Number(object.max_bandwidth_per_user) !== 0)
                    message.max_bandwidth_per_user = object.max_bandwidth_per_user >>> 0;
            return message;
        };

        Ping.toObject = function (message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let object = {};
            if (options.defaults) {
                if ($util.Long) {
                    let long = new $util.Long(0, 0, true);
                    object.timestamp = options.longs === $String ? long.toString() : options.longs === $Number ? long.toNumber() : typeof $BigInt !== "undefined" && options.longs === $BigInt ? long.toBigInt() : long;
                } else
                    object.timestamp = options.longs === $String ? "0" : typeof $BigInt !== "undefined" && options.longs === $BigInt ? $BigInt("0") : 0;
                object.request_extended_information = false;
                if ($util.Long) {
                    let long = new $util.Long(0, 0, true);
                    object.server_version_v2 = options.longs === $String ? long.toString() : options.longs === $Number ? long.toNumber() : typeof $BigInt !== "undefined" && options.longs === $BigInt ? long.toBigInt() : long;
                } else
                    object.server_version_v2 = options.longs === $String ? "0" : typeof $BigInt !== "undefined" && options.longs === $BigInt ? $BigInt("0") : 0;
                object.user_count = 0;
                object.max_user_count = 0;
                object.max_bandwidth_per_user = 0;
            }
            if (message.timestamp != null && $Object.hasOwnProperty.call(message, "timestamp"))
                if (typeof $BigInt !== "undefined" && options.longs === $BigInt)
                    object.timestamp = typeof message.timestamp === "number" ? $BigInt(message.timestamp) : $util.Long.fromBits(message.timestamp.low >>> 0, message.timestamp.high >>> 0, true).toBigInt();
                else if (typeof message.timestamp === "number")
                    object.timestamp = options.longs === $String ? $String(message.timestamp) : message.timestamp;
                else
                    object.timestamp = options.longs === $String ? $util.Long.prototype.toString.call(message.timestamp) : options.longs === $Number ? new $util.LongBits(message.timestamp.low >>> 0, message.timestamp.high >>> 0).toNumber(true) : message.timestamp;
            if (message.request_extended_information != null && $Object.hasOwnProperty.call(message, "request_extended_information"))
                object.request_extended_information = message.request_extended_information;
            if (message.server_version_v2 != null && $Object.hasOwnProperty.call(message, "server_version_v2"))
                if (typeof $BigInt !== "undefined" && options.longs === $BigInt)
                    object.server_version_v2 = typeof message.server_version_v2 === "number" ? $BigInt(message.server_version_v2) : $util.Long.fromBits(message.server_version_v2.low >>> 0, message.server_version_v2.high >>> 0, true).toBigInt();
                else if (typeof message.server_version_v2 === "number")
                    object.server_version_v2 = options.longs === $String ? $String(message.server_version_v2) : message.server_version_v2;
                else
                    object.server_version_v2 = options.longs === $String ? $util.Long.prototype.toString.call(message.server_version_v2) : options.longs === $Number ? new $util.LongBits(message.server_version_v2.low >>> 0, message.server_version_v2.high >>> 0).toNumber(true) : message.server_version_v2;
            if (message.user_count != null && $Object.hasOwnProperty.call(message, "user_count"))
                object.user_count = message.user_count;
            if (message.max_user_count != null && $Object.hasOwnProperty.call(message, "max_user_count"))
                object.max_user_count = message.max_user_count;
            if (message.max_bandwidth_per_user != null && $Object.hasOwnProperty.call(message, "max_bandwidth_per_user"))
                object.max_bandwidth_per_user = message.max_bandwidth_per_user;
            return object;
        };

        Ping.prototype.toJSON = function() {
            return Ping.toObject(this, $protobuf.util.toJSONOptions);
        };

        Ping.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/MumbleUDP.Ping";
        };

        return Ping;
    })();

    return MumbleUDP;
})();

export {
  $root as default
};
