/*eslint-disable block-scoped-var, id-length, no-control-regex, no-magic-numbers, no-mixed-operators, no-prototype-builtins, no-redeclare, no-shadow, no-var, sort-vars, default-case, jsdoc/require-param*/
import $protobuf from "protobufjs/minimal.js";

const $Reader = $protobuf.Reader, $Writer = $protobuf.Writer, $util = $protobuf.util;
const $Object = $util.global.Object, $undefined = $util.global.undefined, $Error = $util.global.Error, $RangeError = $util.global.RangeError, $TypeError = $util.global.TypeError, $parseInt = $util.global.parseInt, $String = $util.global.String, $Number = $util.global.Number, $BigInt = $util.global.BigInt, $Array = $util.global.Array, $Boolean = $util.global.Boolean, $isFinite = $util.global.isFinite;

const $root = $protobuf.roots["default"] || ($protobuf.roots["default"] = {});

export const MumbleProto = $root.MumbleProto = (() => {

    const MumbleProto = {};

    MumbleProto.Version = (function() {

        const Version = function (properties) {
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        Version.prototype.version_v1 = 0;
        Version.prototype.version_v2 = $util.Long ? $util.Long.fromBits(0,0,true) : 0;
        Version.prototype.release = "";
        Version.prototype.os = "";
        Version.prototype.os_version = "";

        Version.create = function(properties) {
            return new Version(properties);
        };

        Version.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.version_v1 != null && $Object.hasOwnProperty.call(message, "version_v1"))
                writer.uint32(8).uint32(message.version_v1);
            if (message.release != null && $Object.hasOwnProperty.call(message, "release"))
                writer.uint32(18).string(message.release);
            if (message.os != null && $Object.hasOwnProperty.call(message, "os"))
                writer.uint32(26).string(message.os);
            if (message.os_version != null && $Object.hasOwnProperty.call(message, "os_version"))
                writer.uint32(34).string(message.os_version);
            if (message.version_v2 != null && $Object.hasOwnProperty.call(message, "version_v2"))
                writer.uint32(40).uint64(message.version_v2);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        Version.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end, message;
            if (length === $undefined)
                end = reader.len;
            else {
                end = reader.pos + length;
                if (end > reader.len)
                    throw $RangeError("index out of range");
                length = reader.len;
                reader.len = end;
            }
            message = _target || new $root.MumbleProto.Version();
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
                        message.version_v1 = reader.uint32();
                        continue;
                    }
                case 5: {
                        if (wireType !== 0)
                            break;
                        message.version_v2 = reader.uint64();
                        continue;
                    }
                case 2: {
                        if (wireType !== 2)
                            break;
                        message.release = reader.string();
                        continue;
                    }
                case 3: {
                        if (wireType !== 2)
                            break;
                        message.os = reader.string();
                        continue;
                    }
                case 4: {
                        if (wireType !== 2)
                            break;
                        message.os_version = reader.string();
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

        Version.verify = function (message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (message.version_v1 != null && $Object.hasOwnProperty.call(message, "version_v1"))
                if (!$util.isInteger(message.version_v1))
                    return "version_v1: integer expected";
            if (message.version_v2 != null && $Object.hasOwnProperty.call(message, "version_v2"))
                if (!$util.isInteger(message.version_v2) && !(message.version_v2 && $util.isInteger(message.version_v2.low) && $util.isInteger(message.version_v2.high)))
                    return "version_v2: integer|Long expected";
            if (message.release != null && $Object.hasOwnProperty.call(message, "release"))
                if (!$util.isString(message.release))
                    return "release: string expected";
            if (message.os != null && $Object.hasOwnProperty.call(message, "os"))
                if (!$util.isString(message.os))
                    return "os: string expected";
            if (message.os_version != null && $Object.hasOwnProperty.call(message, "os_version"))
                if (!$util.isString(message.os_version))
                    return "os_version: string expected";
            return null;
        };

        Version.fromObject = function (object, _depth) {
            if (object instanceof $root.MumbleProto.Version)
                return object;
            if (!$util.isObject(object))
                throw $TypeError(".MumbleProto.Version: object expected");
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let message = new $root.MumbleProto.Version();
            if (object.version_v1 != null)
                message.version_v1 = object.version_v1 >>> 0;
            if (object.version_v2 != null)
                if ($util.Long)
                    message.version_v2 = $util.Long.fromValue(object.version_v2, true);
                else if (typeof object.version_v2 === "string")
                    message.version_v2 = $parseInt(object.version_v2, 10);
                else if (typeof object.version_v2 === "number")
                    message.version_v2 = object.version_v2;
                else if (typeof object.version_v2 === "object")
                    message.version_v2 = new $util.LongBits(object.version_v2.low >>> 0, object.version_v2.high >>> 0).toNumber(true);
            if (object.release != null)
                message.release = $String(object.release);
            if (object.os != null)
                message.os = $String(object.os);
            if (object.os_version != null)
                message.os_version = $String(object.os_version);
            return message;
        };

        Version.toObject = function (message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let object = {};
            if (options.defaults) {
                object.version_v1 = 0;
                object.release = "";
                object.os = "";
                object.os_version = "";
                if ($util.Long) {
                    let long = new $util.Long(0, 0, true);
                    object.version_v2 = options.longs === $String ? long.toString() : options.longs === $Number ? long.toNumber() : typeof $BigInt !== "undefined" && options.longs === $BigInt ? long.toBigInt() : long;
                } else
                    object.version_v2 = options.longs === $String ? "0" : typeof $BigInt !== "undefined" && options.longs === $BigInt ? $BigInt("0") : 0;
            }
            if (message.version_v1 != null && $Object.hasOwnProperty.call(message, "version_v1"))
                object.version_v1 = message.version_v1;
            if (message.release != null && $Object.hasOwnProperty.call(message, "release"))
                object.release = message.release;
            if (message.os != null && $Object.hasOwnProperty.call(message, "os"))
                object.os = message.os;
            if (message.os_version != null && $Object.hasOwnProperty.call(message, "os_version"))
                object.os_version = message.os_version;
            if (message.version_v2 != null && $Object.hasOwnProperty.call(message, "version_v2"))
                if (typeof $BigInt !== "undefined" && options.longs === $BigInt)
                    object.version_v2 = typeof message.version_v2 === "number" ? $BigInt(message.version_v2) : $util.Long.fromBits(message.version_v2.low >>> 0, message.version_v2.high >>> 0, true).toBigInt();
                else if (typeof message.version_v2 === "number")
                    object.version_v2 = options.longs === $String ? $String(message.version_v2) : message.version_v2;
                else
                    object.version_v2 = options.longs === $String ? $util.Long.prototype.toString.call(message.version_v2) : options.longs === $Number ? new $util.LongBits(message.version_v2.low >>> 0, message.version_v2.high >>> 0).toNumber(true) : message.version_v2;
            return object;
        };

        Version.prototype.toJSON = function() {
            return Version.toObject(this, $protobuf.util.toJSONOptions);
        };

        Version.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/MumbleProto.Version";
        };

        return Version;
    })();

    MumbleProto.UDPTunnel = (function() {

        const UDPTunnel = function (properties) {
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        UDPTunnel.prototype.packet = $util.newBuffer([]);

        UDPTunnel.create = function(properties) {
            return new UDPTunnel(properties);
        };

        UDPTunnel.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            writer.uint32(10).bytes(message.packet);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        UDPTunnel.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end, message;
            if (length === $undefined)
                end = reader.len;
            else {
                end = reader.pos + length;
                if (end > reader.len)
                    throw $RangeError("index out of range");
                length = reader.len;
                reader.len = end;
            }
            message = _target || new $root.MumbleProto.UDPTunnel();
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
                        if (wireType !== 2)
                            break;
                        message.packet = reader.bytes();
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
            if (!$Object.hasOwnProperty.call(message, "packet"))
                throw $util.ProtocolError("missing required 'packet'", { instance: message });
            return message;
        };

        UDPTunnel.verify = function (message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (!(message.packet && typeof message.packet.length === "number" || $util.isString(message.packet)))
                return "packet: buffer expected";
            return null;
        };

        UDPTunnel.fromObject = function (object, _depth) {
            if (object instanceof $root.MumbleProto.UDPTunnel)
                return object;
            if (!$util.isObject(object))
                throw $TypeError(".MumbleProto.UDPTunnel: object expected");
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let message = new $root.MumbleProto.UDPTunnel();
            if (object.packet != null)
                if (typeof object.packet === "string")
                    $util.base64.decode(object.packet, message.packet = $util.newBuffer($util.base64.length(object.packet)), 0);
                else if (object.packet.length >= 0)
                    message.packet = object.packet;
            return message;
        };

        UDPTunnel.toObject = function (message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let object = {};
            if (options.defaults)
                if (options.bytes === $String)
                    object.packet = "";
                else {
                    object.packet = [];
                    if (options.bytes !== $Array)
                        object.packet = $util.newBuffer(object.packet);
                }
            if (message.packet != null && $Object.hasOwnProperty.call(message, "packet"))
                object.packet = options.bytes === $String ? $util.base64.encode(message.packet, 0, message.packet.length) : options.bytes === $Array ? $Array.prototype.slice.call(message.packet) : message.packet;
            return object;
        };

        UDPTunnel.prototype.toJSON = function() {
            return UDPTunnel.toObject(this, $protobuf.util.toJSONOptions);
        };

        UDPTunnel.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/MumbleProto.UDPTunnel";
        };

        return UDPTunnel;
    })();

    MumbleProto.Authenticate = (function() {

        const Authenticate = function (properties) {
            this.tokens = [];
            this.celt_versions = [];
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        Authenticate.prototype.username = "";
        Authenticate.prototype.password = "";
        Authenticate.prototype.tokens = $util.emptyArray;
        Authenticate.prototype.celt_versions = $util.emptyArray;
        Authenticate.prototype.opus = false;
        Authenticate.prototype.client_type = 0;

        Authenticate.create = function(properties) {
            return new Authenticate(properties);
        };

        Authenticate.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.username != null && $Object.hasOwnProperty.call(message, "username"))
                writer.uint32(10).string(message.username);
            if (message.password != null && $Object.hasOwnProperty.call(message, "password"))
                writer.uint32(18).string(message.password);
            if (message.tokens != null && message.tokens.length)
                for (let i = 0; i < message.tokens.length; ++i)
                    writer.uint32(26).string(message.tokens[i]);
            if (message.celt_versions != null && message.celt_versions.length)
                for (let i = 0; i < message.celt_versions.length; ++i)
                    writer.uint32(32).int32(message.celt_versions[i]);
            if (message.opus != null && $Object.hasOwnProperty.call(message, "opus"))
                writer.uint32(40).bool(message.opus);
            if (message.client_type != null && $Object.hasOwnProperty.call(message, "client_type"))
                writer.uint32(48).int32(message.client_type);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        Authenticate.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end, message;
            if (length === $undefined)
                end = reader.len;
            else {
                end = reader.pos + length;
                if (end > reader.len)
                    throw $RangeError("index out of range");
                length = reader.len;
                reader.len = end;
            }
            message = _target || new $root.MumbleProto.Authenticate();
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
                        if (wireType !== 2)
                            break;
                        message.username = reader.string();
                        continue;
                    }
                case 2: {
                        if (wireType !== 2)
                            break;
                        message.password = reader.string();
                        continue;
                    }
                case 3: {
                        if (wireType !== 2)
                            break;
                        if (!(message.tokens && message.tokens.length))
                            message.tokens = [];
                        message.tokens.push(reader.string());
                        continue;
                    }
                case 4: {
                        if (wireType === 2) {
                            if (!(message.celt_versions && message.celt_versions.length))
                                message.celt_versions = [];
                            reader.int32s(message.celt_versions);
                            continue;
                        }
                        if (wireType !== 0)
                            break;
                        if (!(message.celt_versions && message.celt_versions.length))
                            message.celt_versions = [];
                        message.celt_versions.push(reader.int32());
                        continue;
                    }
                case 5: {
                        if (wireType !== 0)
                            break;
                        message.opus = reader.bool();
                        continue;
                    }
                case 6: {
                        if (wireType !== 0)
                            break;
                        message.client_type = reader.int32();
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

        Authenticate.verify = function (message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (message.username != null && $Object.hasOwnProperty.call(message, "username"))
                if (!$util.isString(message.username))
                    return "username: string expected";
            if (message.password != null && $Object.hasOwnProperty.call(message, "password"))
                if (!$util.isString(message.password))
                    return "password: string expected";
            if (message.tokens != null && $Object.hasOwnProperty.call(message, "tokens")) {
                if (!$Array.isArray(message.tokens))
                    return "tokens: array expected";
                for (let i = 0; i < message.tokens.length; ++i)
                    if (!$util.isString(message.tokens[i]))
                        return "tokens: string[] expected";
            }
            if (message.celt_versions != null && $Object.hasOwnProperty.call(message, "celt_versions")) {
                if (!$Array.isArray(message.celt_versions))
                    return "celt_versions: array expected";
                for (let i = 0; i < message.celt_versions.length; ++i)
                    if (!$util.isInteger(message.celt_versions[i]))
                        return "celt_versions: integer[] expected";
            }
            if (message.opus != null && $Object.hasOwnProperty.call(message, "opus"))
                if (typeof message.opus !== "boolean")
                    return "opus: boolean expected";
            if (message.client_type != null && $Object.hasOwnProperty.call(message, "client_type"))
                if (!$util.isInteger(message.client_type))
                    return "client_type: integer expected";
            return null;
        };

        Authenticate.fromObject = function (object, _depth) {
            if (object instanceof $root.MumbleProto.Authenticate)
                return object;
            if (!$util.isObject(object))
                throw $TypeError(".MumbleProto.Authenticate: object expected");
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let message = new $root.MumbleProto.Authenticate();
            if (object.username != null)
                message.username = $String(object.username);
            if (object.password != null)
                message.password = $String(object.password);
            if (object.tokens) {
                if (!$Array.isArray(object.tokens))
                    throw $TypeError(".MumbleProto.Authenticate.tokens: array expected");
                message.tokens = $Array(object.tokens.length);
                for (let i = 0; i < object.tokens.length; ++i)
                    message.tokens[i] = $String(object.tokens[i]);
            }
            if (object.celt_versions) {
                if (!$Array.isArray(object.celt_versions))
                    throw $TypeError(".MumbleProto.Authenticate.celt_versions: array expected");
                message.celt_versions = $Array(object.celt_versions.length);
                for (let i = 0; i < object.celt_versions.length; ++i)
                    message.celt_versions[i] = object.celt_versions[i] | 0;
            }
            if (object.opus != null)
                message.opus = $Boolean(object.opus);
            if (object.client_type != null)
                message.client_type = object.client_type | 0;
            return message;
        };

        Authenticate.toObject = function (message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let object = {};
            if (options.arrays || options.defaults) {
                object.tokens = [];
                object.celt_versions = [];
            }
            if (options.defaults) {
                object.username = "";
                object.password = "";
                object.opus = false;
                object.client_type = 0;
            }
            if (message.username != null && $Object.hasOwnProperty.call(message, "username"))
                object.username = message.username;
            if (message.password != null && $Object.hasOwnProperty.call(message, "password"))
                object.password = message.password;
            if (message.tokens && message.tokens.length) {
                object.tokens = $Array(message.tokens.length);
                for (let j = 0; j < message.tokens.length; ++j)
                    object.tokens[j] = message.tokens[j];
            }
            if (message.celt_versions && message.celt_versions.length) {
                object.celt_versions = $Array(message.celt_versions.length);
                for (let j = 0; j < message.celt_versions.length; ++j)
                    object.celt_versions[j] = message.celt_versions[j];
            }
            if (message.opus != null && $Object.hasOwnProperty.call(message, "opus"))
                object.opus = message.opus;
            if (message.client_type != null && $Object.hasOwnProperty.call(message, "client_type"))
                object.client_type = message.client_type;
            return object;
        };

        Authenticate.prototype.toJSON = function() {
            return Authenticate.toObject(this, $protobuf.util.toJSONOptions);
        };

        Authenticate.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/MumbleProto.Authenticate";
        };

        return Authenticate;
    })();

    MumbleProto.Ping = (function() {

        const Ping = function (properties) {
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        Ping.prototype.timestamp = $util.Long ? $util.Long.fromBits(0,0,true) : 0;
        Ping.prototype.good = 0;
        Ping.prototype.late = 0;
        Ping.prototype.lost = 0;
        Ping.prototype.resync = 0;
        Ping.prototype.udp_packets = 0;
        Ping.prototype.tcp_packets = 0;
        Ping.prototype.udp_ping_avg = 0;
        Ping.prototype.udp_ping_var = 0;
        Ping.prototype.tcp_ping_avg = 0;
        Ping.prototype.tcp_ping_var = 0;

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
            if (message.timestamp != null && $Object.hasOwnProperty.call(message, "timestamp"))
                writer.uint32(8).uint64(message.timestamp);
            if (message.good != null && $Object.hasOwnProperty.call(message, "good"))
                writer.uint32(16).uint32(message.good);
            if (message.late != null && $Object.hasOwnProperty.call(message, "late"))
                writer.uint32(24).uint32(message.late);
            if (message.lost != null && $Object.hasOwnProperty.call(message, "lost"))
                writer.uint32(32).uint32(message.lost);
            if (message.resync != null && $Object.hasOwnProperty.call(message, "resync"))
                writer.uint32(40).uint32(message.resync);
            if (message.udp_packets != null && $Object.hasOwnProperty.call(message, "udp_packets"))
                writer.uint32(48).uint32(message.udp_packets);
            if (message.tcp_packets != null && $Object.hasOwnProperty.call(message, "tcp_packets"))
                writer.uint32(56).uint32(message.tcp_packets);
            if (message.udp_ping_avg != null && $Object.hasOwnProperty.call(message, "udp_ping_avg"))
                writer.uint32(69).float(message.udp_ping_avg);
            if (message.udp_ping_var != null && $Object.hasOwnProperty.call(message, "udp_ping_var"))
                writer.uint32(77).float(message.udp_ping_var);
            if (message.tcp_ping_avg != null && $Object.hasOwnProperty.call(message, "tcp_ping_avg"))
                writer.uint32(85).float(message.tcp_ping_avg);
            if (message.tcp_ping_var != null && $Object.hasOwnProperty.call(message, "tcp_ping_var"))
                writer.uint32(93).float(message.tcp_ping_var);
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
            let end, message;
            if (length === $undefined)
                end = reader.len;
            else {
                end = reader.pos + length;
                if (end > reader.len)
                    throw $RangeError("index out of range");
                length = reader.len;
                reader.len = end;
            }
            message = _target || new $root.MumbleProto.Ping();
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
                        message.timestamp = reader.uint64();
                        continue;
                    }
                case 2: {
                        if (wireType !== 0)
                            break;
                        message.good = reader.uint32();
                        continue;
                    }
                case 3: {
                        if (wireType !== 0)
                            break;
                        message.late = reader.uint32();
                        continue;
                    }
                case 4: {
                        if (wireType !== 0)
                            break;
                        message.lost = reader.uint32();
                        continue;
                    }
                case 5: {
                        if (wireType !== 0)
                            break;
                        message.resync = reader.uint32();
                        continue;
                    }
                case 6: {
                        if (wireType !== 0)
                            break;
                        message.udp_packets = reader.uint32();
                        continue;
                    }
                case 7: {
                        if (wireType !== 0)
                            break;
                        message.tcp_packets = reader.uint32();
                        continue;
                    }
                case 8: {
                        if (wireType !== 5)
                            break;
                        message.udp_ping_avg = reader.float();
                        continue;
                    }
                case 9: {
                        if (wireType !== 5)
                            break;
                        message.udp_ping_var = reader.float();
                        continue;
                    }
                case 10: {
                        if (wireType !== 5)
                            break;
                        message.tcp_ping_avg = reader.float();
                        continue;
                    }
                case 11: {
                        if (wireType !== 5)
                            break;
                        message.tcp_ping_var = reader.float();
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
            if (message.good != null && $Object.hasOwnProperty.call(message, "good"))
                if (!$util.isInteger(message.good))
                    return "good: integer expected";
            if (message.late != null && $Object.hasOwnProperty.call(message, "late"))
                if (!$util.isInteger(message.late))
                    return "late: integer expected";
            if (message.lost != null && $Object.hasOwnProperty.call(message, "lost"))
                if (!$util.isInteger(message.lost))
                    return "lost: integer expected";
            if (message.resync != null && $Object.hasOwnProperty.call(message, "resync"))
                if (!$util.isInteger(message.resync))
                    return "resync: integer expected";
            if (message.udp_packets != null && $Object.hasOwnProperty.call(message, "udp_packets"))
                if (!$util.isInteger(message.udp_packets))
                    return "udp_packets: integer expected";
            if (message.tcp_packets != null && $Object.hasOwnProperty.call(message, "tcp_packets"))
                if (!$util.isInteger(message.tcp_packets))
                    return "tcp_packets: integer expected";
            if (message.udp_ping_avg != null && $Object.hasOwnProperty.call(message, "udp_ping_avg"))
                if (typeof message.udp_ping_avg !== "number")
                    return "udp_ping_avg: number expected";
            if (message.udp_ping_var != null && $Object.hasOwnProperty.call(message, "udp_ping_var"))
                if (typeof message.udp_ping_var !== "number")
                    return "udp_ping_var: number expected";
            if (message.tcp_ping_avg != null && $Object.hasOwnProperty.call(message, "tcp_ping_avg"))
                if (typeof message.tcp_ping_avg !== "number")
                    return "tcp_ping_avg: number expected";
            if (message.tcp_ping_var != null && $Object.hasOwnProperty.call(message, "tcp_ping_var"))
                if (typeof message.tcp_ping_var !== "number")
                    return "tcp_ping_var: number expected";
            return null;
        };

        Ping.fromObject = function (object, _depth) {
            if (object instanceof $root.MumbleProto.Ping)
                return object;
            if (!$util.isObject(object))
                throw $TypeError(".MumbleProto.Ping: object expected");
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let message = new $root.MumbleProto.Ping();
            if (object.timestamp != null)
                if ($util.Long)
                    message.timestamp = $util.Long.fromValue(object.timestamp, true);
                else if (typeof object.timestamp === "string")
                    message.timestamp = $parseInt(object.timestamp, 10);
                else if (typeof object.timestamp === "number")
                    message.timestamp = object.timestamp;
                else if (typeof object.timestamp === "object")
                    message.timestamp = new $util.LongBits(object.timestamp.low >>> 0, object.timestamp.high >>> 0).toNumber(true);
            if (object.good != null)
                message.good = object.good >>> 0;
            if (object.late != null)
                message.late = object.late >>> 0;
            if (object.lost != null)
                message.lost = object.lost >>> 0;
            if (object.resync != null)
                message.resync = object.resync >>> 0;
            if (object.udp_packets != null)
                message.udp_packets = object.udp_packets >>> 0;
            if (object.tcp_packets != null)
                message.tcp_packets = object.tcp_packets >>> 0;
            if (object.udp_ping_avg != null)
                message.udp_ping_avg = $Number(object.udp_ping_avg);
            if (object.udp_ping_var != null)
                message.udp_ping_var = $Number(object.udp_ping_var);
            if (object.tcp_ping_avg != null)
                message.tcp_ping_avg = $Number(object.tcp_ping_avg);
            if (object.tcp_ping_var != null)
                message.tcp_ping_var = $Number(object.tcp_ping_var);
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
                object.good = 0;
                object.late = 0;
                object.lost = 0;
                object.resync = 0;
                object.udp_packets = 0;
                object.tcp_packets = 0;
                object.udp_ping_avg = 0;
                object.udp_ping_var = 0;
                object.tcp_ping_avg = 0;
                object.tcp_ping_var = 0;
            }
            if (message.timestamp != null && $Object.hasOwnProperty.call(message, "timestamp"))
                if (typeof $BigInt !== "undefined" && options.longs === $BigInt)
                    object.timestamp = typeof message.timestamp === "number" ? $BigInt(message.timestamp) : $util.Long.fromBits(message.timestamp.low >>> 0, message.timestamp.high >>> 0, true).toBigInt();
                else if (typeof message.timestamp === "number")
                    object.timestamp = options.longs === $String ? $String(message.timestamp) : message.timestamp;
                else
                    object.timestamp = options.longs === $String ? $util.Long.prototype.toString.call(message.timestamp) : options.longs === $Number ? new $util.LongBits(message.timestamp.low >>> 0, message.timestamp.high >>> 0).toNumber(true) : message.timestamp;
            if (message.good != null && $Object.hasOwnProperty.call(message, "good"))
                object.good = message.good;
            if (message.late != null && $Object.hasOwnProperty.call(message, "late"))
                object.late = message.late;
            if (message.lost != null && $Object.hasOwnProperty.call(message, "lost"))
                object.lost = message.lost;
            if (message.resync != null && $Object.hasOwnProperty.call(message, "resync"))
                object.resync = message.resync;
            if (message.udp_packets != null && $Object.hasOwnProperty.call(message, "udp_packets"))
                object.udp_packets = message.udp_packets;
            if (message.tcp_packets != null && $Object.hasOwnProperty.call(message, "tcp_packets"))
                object.tcp_packets = message.tcp_packets;
            if (message.udp_ping_avg != null && $Object.hasOwnProperty.call(message, "udp_ping_avg"))
                object.udp_ping_avg = options.json && !$isFinite(message.udp_ping_avg) ? $String(message.udp_ping_avg) : message.udp_ping_avg;
            if (message.udp_ping_var != null && $Object.hasOwnProperty.call(message, "udp_ping_var"))
                object.udp_ping_var = options.json && !$isFinite(message.udp_ping_var) ? $String(message.udp_ping_var) : message.udp_ping_var;
            if (message.tcp_ping_avg != null && $Object.hasOwnProperty.call(message, "tcp_ping_avg"))
                object.tcp_ping_avg = options.json && !$isFinite(message.tcp_ping_avg) ? $String(message.tcp_ping_avg) : message.tcp_ping_avg;
            if (message.tcp_ping_var != null && $Object.hasOwnProperty.call(message, "tcp_ping_var"))
                object.tcp_ping_var = options.json && !$isFinite(message.tcp_ping_var) ? $String(message.tcp_ping_var) : message.tcp_ping_var;
            return object;
        };

        Ping.prototype.toJSON = function() {
            return Ping.toObject(this, $protobuf.util.toJSONOptions);
        };

        Ping.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/MumbleProto.Ping";
        };

        return Ping;
    })();

    MumbleProto.Reject = (function() {

        const Reject = function (properties) {
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        Reject.prototype.type = 0;
        Reject.prototype.reason = "";

        Reject.create = function(properties) {
            return new Reject(properties);
        };

        Reject.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.type != null && $Object.hasOwnProperty.call(message, "type"))
                writer.uint32(8).int32(message.type);
            if (message.reason != null && $Object.hasOwnProperty.call(message, "reason"))
                writer.uint32(18).string(message.reason);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        Reject.decode = function (reader, length, _end, _depth, _target) {
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
            message = _target || new $root.MumbleProto.Reject();
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
                        value = reader.int32();
                        if ($root.MumbleProto.Reject.RejectType[value] !== $undefined)
                            message.type = value;
                        else if (!reader.discardUnknown) {
                            $util.makeProp(message, "$unknowns", false);
                            (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                        }
                        continue;
                    }
                case 2: {
                        if (wireType !== 2)
                            break;
                        message.reason = reader.string();
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

        Reject.verify = function (message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (message.type != null && $Object.hasOwnProperty.call(message, "type"))
                switch (message.type) {
                default:
                    return "type: enum value expected";
                case 0:
                case 1:
                case 2:
                case 3:
                case 4:
                case 5:
                case 6:
                case 7:
                case 8:
                case 9:
                    break;
                }
            if (message.reason != null && $Object.hasOwnProperty.call(message, "reason"))
                if (!$util.isString(message.reason))
                    return "reason: string expected";
            return null;
        };

        Reject.fromObject = function (object, _depth) {
            if (object instanceof $root.MumbleProto.Reject)
                return object;
            if (!$util.isObject(object))
                throw $TypeError(".MumbleProto.Reject: object expected");
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let message = new $root.MumbleProto.Reject();
            switch (object.type) {
            case "None":
            case 0:
                message.type = 0;
                break;
            case "WrongVersion":
            case 1:
                message.type = 1;
                break;
            case "InvalidUsername":
            case 2:
                message.type = 2;
                break;
            case "WrongUserPW":
            case 3:
                message.type = 3;
                break;
            case "WrongServerPW":
            case 4:
                message.type = 4;
                break;
            case "UsernameInUse":
            case 5:
                message.type = 5;
                break;
            case "ServerFull":
            case 6:
                message.type = 6;
                break;
            case "NoCertificate":
            case 7:
                message.type = 7;
                break;
            case "AuthenticatorFail":
            case 8:
                message.type = 8;
                break;
            case "NoNewConnections":
            case 9:
                message.type = 9;
                break;
            default:
            }
            if (object.reason != null)
                message.reason = $String(object.reason);
            return message;
        };

        Reject.toObject = function (message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let object = {};
            if (options.defaults) {
                object.type = options.enums === $String ? "None" : 0;
                object.reason = "";
            }
            if (message.type != null && $Object.hasOwnProperty.call(message, "type"))
                object.type = options.enums === $String ? $root.MumbleProto.Reject.RejectType[message.type] === $undefined ? message.type : $root.MumbleProto.Reject.RejectType[message.type] : message.type;
            if (message.reason != null && $Object.hasOwnProperty.call(message, "reason"))
                object.reason = message.reason;
            return object;
        };

        Reject.prototype.toJSON = function() {
            return Reject.toObject(this, $protobuf.util.toJSONOptions);
        };

        Reject.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/MumbleProto.Reject";
        };

        Reject.RejectType = (function() {
            const valuesById = $Object.create(null), values = $Object.create(valuesById);
            values[valuesById[0] = "None"] = 0;
            values[valuesById[1] = "WrongVersion"] = 1;
            values[valuesById[2] = "InvalidUsername"] = 2;
            values[valuesById[3] = "WrongUserPW"] = 3;
            values[valuesById[4] = "WrongServerPW"] = 4;
            values[valuesById[5] = "UsernameInUse"] = 5;
            values[valuesById[6] = "ServerFull"] = 6;
            values[valuesById[7] = "NoCertificate"] = 7;
            values[valuesById[8] = "AuthenticatorFail"] = 8;
            values[valuesById[9] = "NoNewConnections"] = 9;
            return values;
        })();

        return Reject;
    })();

    MumbleProto.ServerSync = (function() {

        const ServerSync = function (properties) {
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        ServerSync.prototype.session = 0;
        ServerSync.prototype.max_bandwidth = 0;
        ServerSync.prototype.welcome_text = "";
        ServerSync.prototype.permissions = $util.Long ? $util.Long.fromBits(0,0,true) : 0;

        ServerSync.create = function(properties) {
            return new ServerSync(properties);
        };

        ServerSync.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.session != null && $Object.hasOwnProperty.call(message, "session"))
                writer.uint32(8).uint32(message.session);
            if (message.max_bandwidth != null && $Object.hasOwnProperty.call(message, "max_bandwidth"))
                writer.uint32(16).uint32(message.max_bandwidth);
            if (message.welcome_text != null && $Object.hasOwnProperty.call(message, "welcome_text"))
                writer.uint32(26).string(message.welcome_text);
            if (message.permissions != null && $Object.hasOwnProperty.call(message, "permissions"))
                writer.uint32(32).uint64(message.permissions);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        ServerSync.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end, message;
            if (length === $undefined)
                end = reader.len;
            else {
                end = reader.pos + length;
                if (end > reader.len)
                    throw $RangeError("index out of range");
                length = reader.len;
                reader.len = end;
            }
            message = _target || new $root.MumbleProto.ServerSync();
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
                        message.session = reader.uint32();
                        continue;
                    }
                case 2: {
                        if (wireType !== 0)
                            break;
                        message.max_bandwidth = reader.uint32();
                        continue;
                    }
                case 3: {
                        if (wireType !== 2)
                            break;
                        message.welcome_text = reader.string();
                        continue;
                    }
                case 4: {
                        if (wireType !== 0)
                            break;
                        message.permissions = reader.uint64();
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

        ServerSync.verify = function (message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (message.session != null && $Object.hasOwnProperty.call(message, "session"))
                if (!$util.isInteger(message.session))
                    return "session: integer expected";
            if (message.max_bandwidth != null && $Object.hasOwnProperty.call(message, "max_bandwidth"))
                if (!$util.isInteger(message.max_bandwidth))
                    return "max_bandwidth: integer expected";
            if (message.welcome_text != null && $Object.hasOwnProperty.call(message, "welcome_text"))
                if (!$util.isString(message.welcome_text))
                    return "welcome_text: string expected";
            if (message.permissions != null && $Object.hasOwnProperty.call(message, "permissions"))
                if (!$util.isInteger(message.permissions) && !(message.permissions && $util.isInteger(message.permissions.low) && $util.isInteger(message.permissions.high)))
                    return "permissions: integer|Long expected";
            return null;
        };

        ServerSync.fromObject = function (object, _depth) {
            if (object instanceof $root.MumbleProto.ServerSync)
                return object;
            if (!$util.isObject(object))
                throw $TypeError(".MumbleProto.ServerSync: object expected");
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let message = new $root.MumbleProto.ServerSync();
            if (object.session != null)
                message.session = object.session >>> 0;
            if (object.max_bandwidth != null)
                message.max_bandwidth = object.max_bandwidth >>> 0;
            if (object.welcome_text != null)
                message.welcome_text = $String(object.welcome_text);
            if (object.permissions != null)
                if ($util.Long)
                    message.permissions = $util.Long.fromValue(object.permissions, true);
                else if (typeof object.permissions === "string")
                    message.permissions = $parseInt(object.permissions, 10);
                else if (typeof object.permissions === "number")
                    message.permissions = object.permissions;
                else if (typeof object.permissions === "object")
                    message.permissions = new $util.LongBits(object.permissions.low >>> 0, object.permissions.high >>> 0).toNumber(true);
            return message;
        };

        ServerSync.toObject = function (message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let object = {};
            if (options.defaults) {
                object.session = 0;
                object.max_bandwidth = 0;
                object.welcome_text = "";
                if ($util.Long) {
                    let long = new $util.Long(0, 0, true);
                    object.permissions = options.longs === $String ? long.toString() : options.longs === $Number ? long.toNumber() : typeof $BigInt !== "undefined" && options.longs === $BigInt ? long.toBigInt() : long;
                } else
                    object.permissions = options.longs === $String ? "0" : typeof $BigInt !== "undefined" && options.longs === $BigInt ? $BigInt("0") : 0;
            }
            if (message.session != null && $Object.hasOwnProperty.call(message, "session"))
                object.session = message.session;
            if (message.max_bandwidth != null && $Object.hasOwnProperty.call(message, "max_bandwidth"))
                object.max_bandwidth = message.max_bandwidth;
            if (message.welcome_text != null && $Object.hasOwnProperty.call(message, "welcome_text"))
                object.welcome_text = message.welcome_text;
            if (message.permissions != null && $Object.hasOwnProperty.call(message, "permissions"))
                if (typeof $BigInt !== "undefined" && options.longs === $BigInt)
                    object.permissions = typeof message.permissions === "number" ? $BigInt(message.permissions) : $util.Long.fromBits(message.permissions.low >>> 0, message.permissions.high >>> 0, true).toBigInt();
                else if (typeof message.permissions === "number")
                    object.permissions = options.longs === $String ? $String(message.permissions) : message.permissions;
                else
                    object.permissions = options.longs === $String ? $util.Long.prototype.toString.call(message.permissions) : options.longs === $Number ? new $util.LongBits(message.permissions.low >>> 0, message.permissions.high >>> 0).toNumber(true) : message.permissions;
            return object;
        };

        ServerSync.prototype.toJSON = function() {
            return ServerSync.toObject(this, $protobuf.util.toJSONOptions);
        };

        ServerSync.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/MumbleProto.ServerSync";
        };

        return ServerSync;
    })();

    MumbleProto.ChannelRemove = (function() {

        const ChannelRemove = function (properties) {
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        ChannelRemove.prototype.channel_id = 0;

        ChannelRemove.create = function(properties) {
            return new ChannelRemove(properties);
        };

        ChannelRemove.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            writer.uint32(8).uint32(message.channel_id);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        ChannelRemove.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end, message;
            if (length === $undefined)
                end = reader.len;
            else {
                end = reader.pos + length;
                if (end > reader.len)
                    throw $RangeError("index out of range");
                length = reader.len;
                reader.len = end;
            }
            message = _target || new $root.MumbleProto.ChannelRemove();
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
                        message.channel_id = reader.uint32();
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
            if (!$Object.hasOwnProperty.call(message, "channel_id"))
                throw $util.ProtocolError("missing required 'channel_id'", { instance: message });
            return message;
        };

        ChannelRemove.verify = function (message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (!$util.isInteger(message.channel_id))
                return "channel_id: integer expected";
            return null;
        };

        ChannelRemove.fromObject = function (object, _depth) {
            if (object instanceof $root.MumbleProto.ChannelRemove)
                return object;
            if (!$util.isObject(object))
                throw $TypeError(".MumbleProto.ChannelRemove: object expected");
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let message = new $root.MumbleProto.ChannelRemove();
            if (object.channel_id != null)
                message.channel_id = object.channel_id >>> 0;
            return message;
        };

        ChannelRemove.toObject = function (message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let object = {};
            if (options.defaults)
                object.channel_id = 0;
            if (message.channel_id != null && $Object.hasOwnProperty.call(message, "channel_id"))
                object.channel_id = message.channel_id;
            return object;
        };

        ChannelRemove.prototype.toJSON = function() {
            return ChannelRemove.toObject(this, $protobuf.util.toJSONOptions);
        };

        ChannelRemove.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/MumbleProto.ChannelRemove";
        };

        return ChannelRemove;
    })();

    MumbleProto.ChannelState = (function() {

        const ChannelState = function (properties) {
            this.links = [];
            this.links_add = [];
            this.links_remove = [];
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        ChannelState.prototype.channel_id = 0;
        ChannelState.prototype.parent = 0;
        ChannelState.prototype.name = "";
        ChannelState.prototype.links = $util.emptyArray;
        ChannelState.prototype.description = "";
        ChannelState.prototype.links_add = $util.emptyArray;
        ChannelState.prototype.links_remove = $util.emptyArray;
        ChannelState.prototype.temporary = false;
        ChannelState.prototype.position = 0;
        ChannelState.prototype.description_hash = $util.newBuffer([]);
        ChannelState.prototype.max_users = 0;
        ChannelState.prototype.is_enter_restricted = false;
        ChannelState.prototype.can_enter = false;

        ChannelState.create = function(properties) {
            return new ChannelState(properties);
        };

        ChannelState.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.channel_id != null && $Object.hasOwnProperty.call(message, "channel_id"))
                writer.uint32(8).uint32(message.channel_id);
            if (message.parent != null && $Object.hasOwnProperty.call(message, "parent"))
                writer.uint32(16).uint32(message.parent);
            if (message.name != null && $Object.hasOwnProperty.call(message, "name"))
                writer.uint32(26).string(message.name);
            if (message.links != null && message.links.length)
                for (let i = 0; i < message.links.length; ++i)
                    writer.uint32(32).uint32(message.links[i]);
            if (message.description != null && $Object.hasOwnProperty.call(message, "description"))
                writer.uint32(42).string(message.description);
            if (message.links_add != null && message.links_add.length)
                for (let i = 0; i < message.links_add.length; ++i)
                    writer.uint32(48).uint32(message.links_add[i]);
            if (message.links_remove != null && message.links_remove.length)
                for (let i = 0; i < message.links_remove.length; ++i)
                    writer.uint32(56).uint32(message.links_remove[i]);
            if (message.temporary != null && $Object.hasOwnProperty.call(message, "temporary"))
                writer.uint32(64).bool(message.temporary);
            if (message.position != null && $Object.hasOwnProperty.call(message, "position"))
                writer.uint32(72).int32(message.position);
            if (message.description_hash != null && $Object.hasOwnProperty.call(message, "description_hash"))
                writer.uint32(82).bytes(message.description_hash);
            if (message.max_users != null && $Object.hasOwnProperty.call(message, "max_users"))
                writer.uint32(88).uint32(message.max_users);
            if (message.is_enter_restricted != null && $Object.hasOwnProperty.call(message, "is_enter_restricted"))
                writer.uint32(96).bool(message.is_enter_restricted);
            if (message.can_enter != null && $Object.hasOwnProperty.call(message, "can_enter"))
                writer.uint32(104).bool(message.can_enter);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        ChannelState.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end, message;
            if (length === $undefined)
                end = reader.len;
            else {
                end = reader.pos + length;
                if (end > reader.len)
                    throw $RangeError("index out of range");
                length = reader.len;
                reader.len = end;
            }
            message = _target || new $root.MumbleProto.ChannelState();
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
                        message.channel_id = reader.uint32();
                        continue;
                    }
                case 2: {
                        if (wireType !== 0)
                            break;
                        message.parent = reader.uint32();
                        continue;
                    }
                case 3: {
                        if (wireType !== 2)
                            break;
                        message.name = reader.string();
                        continue;
                    }
                case 4: {
                        if (wireType === 2) {
                            if (!(message.links && message.links.length))
                                message.links = [];
                            reader.uint32s(message.links);
                            continue;
                        }
                        if (wireType !== 0)
                            break;
                        if (!(message.links && message.links.length))
                            message.links = [];
                        message.links.push(reader.uint32());
                        continue;
                    }
                case 5: {
                        if (wireType !== 2)
                            break;
                        message.description = reader.string();
                        continue;
                    }
                case 6: {
                        if (wireType === 2) {
                            if (!(message.links_add && message.links_add.length))
                                message.links_add = [];
                            reader.uint32s(message.links_add);
                            continue;
                        }
                        if (wireType !== 0)
                            break;
                        if (!(message.links_add && message.links_add.length))
                            message.links_add = [];
                        message.links_add.push(reader.uint32());
                        continue;
                    }
                case 7: {
                        if (wireType === 2) {
                            if (!(message.links_remove && message.links_remove.length))
                                message.links_remove = [];
                            reader.uint32s(message.links_remove);
                            continue;
                        }
                        if (wireType !== 0)
                            break;
                        if (!(message.links_remove && message.links_remove.length))
                            message.links_remove = [];
                        message.links_remove.push(reader.uint32());
                        continue;
                    }
                case 8: {
                        if (wireType !== 0)
                            break;
                        message.temporary = reader.bool();
                        continue;
                    }
                case 9: {
                        if (wireType !== 0)
                            break;
                        message.position = reader.int32();
                        continue;
                    }
                case 10: {
                        if (wireType !== 2)
                            break;
                        message.description_hash = reader.bytes();
                        continue;
                    }
                case 11: {
                        if (wireType !== 0)
                            break;
                        message.max_users = reader.uint32();
                        continue;
                    }
                case 12: {
                        if (wireType !== 0)
                            break;
                        message.is_enter_restricted = reader.bool();
                        continue;
                    }
                case 13: {
                        if (wireType !== 0)
                            break;
                        message.can_enter = reader.bool();
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

        ChannelState.verify = function (message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (message.channel_id != null && $Object.hasOwnProperty.call(message, "channel_id"))
                if (!$util.isInteger(message.channel_id))
                    return "channel_id: integer expected";
            if (message.parent != null && $Object.hasOwnProperty.call(message, "parent"))
                if (!$util.isInteger(message.parent))
                    return "parent: integer expected";
            if (message.name != null && $Object.hasOwnProperty.call(message, "name"))
                if (!$util.isString(message.name))
                    return "name: string expected";
            if (message.links != null && $Object.hasOwnProperty.call(message, "links")) {
                if (!$Array.isArray(message.links))
                    return "links: array expected";
                for (let i = 0; i < message.links.length; ++i)
                    if (!$util.isInteger(message.links[i]))
                        return "links: integer[] expected";
            }
            if (message.description != null && $Object.hasOwnProperty.call(message, "description"))
                if (!$util.isString(message.description))
                    return "description: string expected";
            if (message.links_add != null && $Object.hasOwnProperty.call(message, "links_add")) {
                if (!$Array.isArray(message.links_add))
                    return "links_add: array expected";
                for (let i = 0; i < message.links_add.length; ++i)
                    if (!$util.isInteger(message.links_add[i]))
                        return "links_add: integer[] expected";
            }
            if (message.links_remove != null && $Object.hasOwnProperty.call(message, "links_remove")) {
                if (!$Array.isArray(message.links_remove))
                    return "links_remove: array expected";
                for (let i = 0; i < message.links_remove.length; ++i)
                    if (!$util.isInteger(message.links_remove[i]))
                        return "links_remove: integer[] expected";
            }
            if (message.temporary != null && $Object.hasOwnProperty.call(message, "temporary"))
                if (typeof message.temporary !== "boolean")
                    return "temporary: boolean expected";
            if (message.position != null && $Object.hasOwnProperty.call(message, "position"))
                if (!$util.isInteger(message.position))
                    return "position: integer expected";
            if (message.description_hash != null && $Object.hasOwnProperty.call(message, "description_hash"))
                if (!(message.description_hash && typeof message.description_hash.length === "number" || $util.isString(message.description_hash)))
                    return "description_hash: buffer expected";
            if (message.max_users != null && $Object.hasOwnProperty.call(message, "max_users"))
                if (!$util.isInteger(message.max_users))
                    return "max_users: integer expected";
            if (message.is_enter_restricted != null && $Object.hasOwnProperty.call(message, "is_enter_restricted"))
                if (typeof message.is_enter_restricted !== "boolean")
                    return "is_enter_restricted: boolean expected";
            if (message.can_enter != null && $Object.hasOwnProperty.call(message, "can_enter"))
                if (typeof message.can_enter !== "boolean")
                    return "can_enter: boolean expected";
            return null;
        };

        ChannelState.fromObject = function (object, _depth) {
            if (object instanceof $root.MumbleProto.ChannelState)
                return object;
            if (!$util.isObject(object))
                throw $TypeError(".MumbleProto.ChannelState: object expected");
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let message = new $root.MumbleProto.ChannelState();
            if (object.channel_id != null)
                message.channel_id = object.channel_id >>> 0;
            if (object.parent != null)
                message.parent = object.parent >>> 0;
            if (object.name != null)
                message.name = $String(object.name);
            if (object.links) {
                if (!$Array.isArray(object.links))
                    throw $TypeError(".MumbleProto.ChannelState.links: array expected");
                message.links = $Array(object.links.length);
                for (let i = 0; i < object.links.length; ++i)
                    message.links[i] = object.links[i] >>> 0;
            }
            if (object.description != null)
                message.description = $String(object.description);
            if (object.links_add) {
                if (!$Array.isArray(object.links_add))
                    throw $TypeError(".MumbleProto.ChannelState.links_add: array expected");
                message.links_add = $Array(object.links_add.length);
                for (let i = 0; i < object.links_add.length; ++i)
                    message.links_add[i] = object.links_add[i] >>> 0;
            }
            if (object.links_remove) {
                if (!$Array.isArray(object.links_remove))
                    throw $TypeError(".MumbleProto.ChannelState.links_remove: array expected");
                message.links_remove = $Array(object.links_remove.length);
                for (let i = 0; i < object.links_remove.length; ++i)
                    message.links_remove[i] = object.links_remove[i] >>> 0;
            }
            if (object.temporary != null)
                message.temporary = $Boolean(object.temporary);
            if (object.position != null)
                message.position = object.position | 0;
            if (object.description_hash != null)
                if (typeof object.description_hash === "string")
                    $util.base64.decode(object.description_hash, message.description_hash = $util.newBuffer($util.base64.length(object.description_hash)), 0);
                else if (object.description_hash.length >= 0)
                    message.description_hash = object.description_hash;
            if (object.max_users != null)
                message.max_users = object.max_users >>> 0;
            if (object.is_enter_restricted != null)
                message.is_enter_restricted = $Boolean(object.is_enter_restricted);
            if (object.can_enter != null)
                message.can_enter = $Boolean(object.can_enter);
            return message;
        };

        ChannelState.toObject = function (message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let object = {};
            if (options.arrays || options.defaults) {
                object.links = [];
                object.links_add = [];
                object.links_remove = [];
            }
            if (options.defaults) {
                object.channel_id = 0;
                object.parent = 0;
                object.name = "";
                object.description = "";
                object.temporary = false;
                object.position = 0;
                if (options.bytes === $String)
                    object.description_hash = "";
                else {
                    object.description_hash = [];
                    if (options.bytes !== $Array)
                        object.description_hash = $util.newBuffer(object.description_hash);
                }
                object.max_users = 0;
                object.is_enter_restricted = false;
                object.can_enter = false;
            }
            if (message.channel_id != null && $Object.hasOwnProperty.call(message, "channel_id"))
                object.channel_id = message.channel_id;
            if (message.parent != null && $Object.hasOwnProperty.call(message, "parent"))
                object.parent = message.parent;
            if (message.name != null && $Object.hasOwnProperty.call(message, "name"))
                object.name = message.name;
            if (message.links && message.links.length) {
                object.links = $Array(message.links.length);
                for (let j = 0; j < message.links.length; ++j)
                    object.links[j] = message.links[j];
            }
            if (message.description != null && $Object.hasOwnProperty.call(message, "description"))
                object.description = message.description;
            if (message.links_add && message.links_add.length) {
                object.links_add = $Array(message.links_add.length);
                for (let j = 0; j < message.links_add.length; ++j)
                    object.links_add[j] = message.links_add[j];
            }
            if (message.links_remove && message.links_remove.length) {
                object.links_remove = $Array(message.links_remove.length);
                for (let j = 0; j < message.links_remove.length; ++j)
                    object.links_remove[j] = message.links_remove[j];
            }
            if (message.temporary != null && $Object.hasOwnProperty.call(message, "temporary"))
                object.temporary = message.temporary;
            if (message.position != null && $Object.hasOwnProperty.call(message, "position"))
                object.position = message.position;
            if (message.description_hash != null && $Object.hasOwnProperty.call(message, "description_hash"))
                object.description_hash = options.bytes === $String ? $util.base64.encode(message.description_hash, 0, message.description_hash.length) : options.bytes === $Array ? $Array.prototype.slice.call(message.description_hash) : message.description_hash;
            if (message.max_users != null && $Object.hasOwnProperty.call(message, "max_users"))
                object.max_users = message.max_users;
            if (message.is_enter_restricted != null && $Object.hasOwnProperty.call(message, "is_enter_restricted"))
                object.is_enter_restricted = message.is_enter_restricted;
            if (message.can_enter != null && $Object.hasOwnProperty.call(message, "can_enter"))
                object.can_enter = message.can_enter;
            return object;
        };

        ChannelState.prototype.toJSON = function() {
            return ChannelState.toObject(this, $protobuf.util.toJSONOptions);
        };

        ChannelState.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/MumbleProto.ChannelState";
        };

        return ChannelState;
    })();

    MumbleProto.UserRemove = (function() {

        const UserRemove = function (properties) {
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        UserRemove.prototype.session = 0;
        UserRemove.prototype.actor = 0;
        UserRemove.prototype.reason = "";
        UserRemove.prototype.ban = false;
        UserRemove.prototype.ban_certificate = false;
        UserRemove.prototype.ban_ip = false;

        UserRemove.create = function(properties) {
            return new UserRemove(properties);
        };

        UserRemove.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            writer.uint32(8).uint32(message.session);
            if (message.actor != null && $Object.hasOwnProperty.call(message, "actor"))
                writer.uint32(16).uint32(message.actor);
            if (message.reason != null && $Object.hasOwnProperty.call(message, "reason"))
                writer.uint32(26).string(message.reason);
            if (message.ban != null && $Object.hasOwnProperty.call(message, "ban"))
                writer.uint32(32).bool(message.ban);
            if (message.ban_certificate != null && $Object.hasOwnProperty.call(message, "ban_certificate"))
                writer.uint32(40).bool(message.ban_certificate);
            if (message.ban_ip != null && $Object.hasOwnProperty.call(message, "ban_ip"))
                writer.uint32(48).bool(message.ban_ip);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        UserRemove.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end, message;
            if (length === $undefined)
                end = reader.len;
            else {
                end = reader.pos + length;
                if (end > reader.len)
                    throw $RangeError("index out of range");
                length = reader.len;
                reader.len = end;
            }
            message = _target || new $root.MumbleProto.UserRemove();
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
                        message.session = reader.uint32();
                        continue;
                    }
                case 2: {
                        if (wireType !== 0)
                            break;
                        message.actor = reader.uint32();
                        continue;
                    }
                case 3: {
                        if (wireType !== 2)
                            break;
                        message.reason = reader.string();
                        continue;
                    }
                case 4: {
                        if (wireType !== 0)
                            break;
                        message.ban = reader.bool();
                        continue;
                    }
                case 5: {
                        if (wireType !== 0)
                            break;
                        message.ban_certificate = reader.bool();
                        continue;
                    }
                case 6: {
                        if (wireType !== 0)
                            break;
                        message.ban_ip = reader.bool();
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
            if (!$Object.hasOwnProperty.call(message, "session"))
                throw $util.ProtocolError("missing required 'session'", { instance: message });
            return message;
        };

        UserRemove.verify = function (message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (!$util.isInteger(message.session))
                return "session: integer expected";
            if (message.actor != null && $Object.hasOwnProperty.call(message, "actor"))
                if (!$util.isInteger(message.actor))
                    return "actor: integer expected";
            if (message.reason != null && $Object.hasOwnProperty.call(message, "reason"))
                if (!$util.isString(message.reason))
                    return "reason: string expected";
            if (message.ban != null && $Object.hasOwnProperty.call(message, "ban"))
                if (typeof message.ban !== "boolean")
                    return "ban: boolean expected";
            if (message.ban_certificate != null && $Object.hasOwnProperty.call(message, "ban_certificate"))
                if (typeof message.ban_certificate !== "boolean")
                    return "ban_certificate: boolean expected";
            if (message.ban_ip != null && $Object.hasOwnProperty.call(message, "ban_ip"))
                if (typeof message.ban_ip !== "boolean")
                    return "ban_ip: boolean expected";
            return null;
        };

        UserRemove.fromObject = function (object, _depth) {
            if (object instanceof $root.MumbleProto.UserRemove)
                return object;
            if (!$util.isObject(object))
                throw $TypeError(".MumbleProto.UserRemove: object expected");
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let message = new $root.MumbleProto.UserRemove();
            if (object.session != null)
                message.session = object.session >>> 0;
            if (object.actor != null)
                message.actor = object.actor >>> 0;
            if (object.reason != null)
                message.reason = $String(object.reason);
            if (object.ban != null)
                message.ban = $Boolean(object.ban);
            if (object.ban_certificate != null)
                message.ban_certificate = $Boolean(object.ban_certificate);
            if (object.ban_ip != null)
                message.ban_ip = $Boolean(object.ban_ip);
            return message;
        };

        UserRemove.toObject = function (message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let object = {};
            if (options.defaults) {
                object.session = 0;
                object.actor = 0;
                object.reason = "";
                object.ban = false;
                object.ban_certificate = false;
                object.ban_ip = false;
            }
            if (message.session != null && $Object.hasOwnProperty.call(message, "session"))
                object.session = message.session;
            if (message.actor != null && $Object.hasOwnProperty.call(message, "actor"))
                object.actor = message.actor;
            if (message.reason != null && $Object.hasOwnProperty.call(message, "reason"))
                object.reason = message.reason;
            if (message.ban != null && $Object.hasOwnProperty.call(message, "ban"))
                object.ban = message.ban;
            if (message.ban_certificate != null && $Object.hasOwnProperty.call(message, "ban_certificate"))
                object.ban_certificate = message.ban_certificate;
            if (message.ban_ip != null && $Object.hasOwnProperty.call(message, "ban_ip"))
                object.ban_ip = message.ban_ip;
            return object;
        };

        UserRemove.prototype.toJSON = function() {
            return UserRemove.toObject(this, $protobuf.util.toJSONOptions);
        };

        UserRemove.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/MumbleProto.UserRemove";
        };

        return UserRemove;
    })();

    MumbleProto.UserState = (function() {

        const UserState = function (properties) {
            this.temporary_access_tokens = [];
            this.listening_channel_add = [];
            this.listening_channel_remove = [];
            this.listening_volume_adjustment = [];
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        UserState.prototype.session = 0;
        UserState.prototype.actor = 0;
        UserState.prototype.name = "";
        UserState.prototype.user_id = 0;
        UserState.prototype.channel_id = 0;
        UserState.prototype.mute = false;
        UserState.prototype.deaf = false;
        UserState.prototype.suppress = false;
        UserState.prototype.self_mute = false;
        UserState.prototype.self_deaf = false;
        UserState.prototype.texture = $util.newBuffer([]);
        UserState.prototype.plugin_context = $util.newBuffer([]);
        UserState.prototype.plugin_identity = "";
        UserState.prototype.comment = "";
        UserState.prototype.hash = "";
        UserState.prototype.comment_hash = $util.newBuffer([]);
        UserState.prototype.texture_hash = $util.newBuffer([]);
        UserState.prototype.priority_speaker = false;
        UserState.prototype.recording = false;
        UserState.prototype.temporary_access_tokens = $util.emptyArray;
        UserState.prototype.listening_channel_add = $util.emptyArray;
        UserState.prototype.listening_channel_remove = $util.emptyArray;
        UserState.prototype.listening_volume_adjustment = $util.emptyArray;

        UserState.create = function(properties) {
            return new UserState(properties);
        };

        UserState.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.session != null && $Object.hasOwnProperty.call(message, "session"))
                writer.uint32(8).uint32(message.session);
            if (message.actor != null && $Object.hasOwnProperty.call(message, "actor"))
                writer.uint32(16).uint32(message.actor);
            if (message.name != null && $Object.hasOwnProperty.call(message, "name"))
                writer.uint32(26).string(message.name);
            if (message.user_id != null && $Object.hasOwnProperty.call(message, "user_id"))
                writer.uint32(32).uint32(message.user_id);
            if (message.channel_id != null && $Object.hasOwnProperty.call(message, "channel_id"))
                writer.uint32(40).uint32(message.channel_id);
            if (message.mute != null && $Object.hasOwnProperty.call(message, "mute"))
                writer.uint32(48).bool(message.mute);
            if (message.deaf != null && $Object.hasOwnProperty.call(message, "deaf"))
                writer.uint32(56).bool(message.deaf);
            if (message.suppress != null && $Object.hasOwnProperty.call(message, "suppress"))
                writer.uint32(64).bool(message.suppress);
            if (message.self_mute != null && $Object.hasOwnProperty.call(message, "self_mute"))
                writer.uint32(72).bool(message.self_mute);
            if (message.self_deaf != null && $Object.hasOwnProperty.call(message, "self_deaf"))
                writer.uint32(80).bool(message.self_deaf);
            if (message.texture != null && $Object.hasOwnProperty.call(message, "texture"))
                writer.uint32(90).bytes(message.texture);
            if (message.plugin_context != null && $Object.hasOwnProperty.call(message, "plugin_context"))
                writer.uint32(98).bytes(message.plugin_context);
            if (message.plugin_identity != null && $Object.hasOwnProperty.call(message, "plugin_identity"))
                writer.uint32(106).string(message.plugin_identity);
            if (message.comment != null && $Object.hasOwnProperty.call(message, "comment"))
                writer.uint32(114).string(message.comment);
            if (message.hash != null && $Object.hasOwnProperty.call(message, "hash"))
                writer.uint32(122).string(message.hash);
            if (message.comment_hash != null && $Object.hasOwnProperty.call(message, "comment_hash"))
                writer.uint32(130).bytes(message.comment_hash);
            if (message.texture_hash != null && $Object.hasOwnProperty.call(message, "texture_hash"))
                writer.uint32(138).bytes(message.texture_hash);
            if (message.priority_speaker != null && $Object.hasOwnProperty.call(message, "priority_speaker"))
                writer.uint32(144).bool(message.priority_speaker);
            if (message.recording != null && $Object.hasOwnProperty.call(message, "recording"))
                writer.uint32(152).bool(message.recording);
            if (message.temporary_access_tokens != null && message.temporary_access_tokens.length)
                for (let i = 0; i < message.temporary_access_tokens.length; ++i)
                    writer.uint32(162).string(message.temporary_access_tokens[i]);
            if (message.listening_channel_add != null && message.listening_channel_add.length)
                for (let i = 0; i < message.listening_channel_add.length; ++i)
                    writer.uint32(168).uint32(message.listening_channel_add[i]);
            if (message.listening_channel_remove != null && message.listening_channel_remove.length)
                for (let i = 0; i < message.listening_channel_remove.length; ++i)
                    writer.uint32(176).uint32(message.listening_channel_remove[i]);
            if (message.listening_volume_adjustment != null && message.listening_volume_adjustment.length)
                for (let i = 0; i < message.listening_volume_adjustment.length; ++i)
                    $root.MumbleProto.UserState.VolumeAdjustment.encode(message.listening_volume_adjustment[i], writer.uint32(186).fork(), _depth + 1).ldelim();
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        UserState.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end, message;
            if (length === $undefined)
                end = reader.len;
            else {
                end = reader.pos + length;
                if (end > reader.len)
                    throw $RangeError("index out of range");
                length = reader.len;
                reader.len = end;
            }
            message = _target || new $root.MumbleProto.UserState();
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
                        message.session = reader.uint32();
                        continue;
                    }
                case 2: {
                        if (wireType !== 0)
                            break;
                        message.actor = reader.uint32();
                        continue;
                    }
                case 3: {
                        if (wireType !== 2)
                            break;
                        message.name = reader.string();
                        continue;
                    }
                case 4: {
                        if (wireType !== 0)
                            break;
                        message.user_id = reader.uint32();
                        continue;
                    }
                case 5: {
                        if (wireType !== 0)
                            break;
                        message.channel_id = reader.uint32();
                        continue;
                    }
                case 6: {
                        if (wireType !== 0)
                            break;
                        message.mute = reader.bool();
                        continue;
                    }
                case 7: {
                        if (wireType !== 0)
                            break;
                        message.deaf = reader.bool();
                        continue;
                    }
                case 8: {
                        if (wireType !== 0)
                            break;
                        message.suppress = reader.bool();
                        continue;
                    }
                case 9: {
                        if (wireType !== 0)
                            break;
                        message.self_mute = reader.bool();
                        continue;
                    }
                case 10: {
                        if (wireType !== 0)
                            break;
                        message.self_deaf = reader.bool();
                        continue;
                    }
                case 11: {
                        if (wireType !== 2)
                            break;
                        message.texture = reader.bytes();
                        continue;
                    }
                case 12: {
                        if (wireType !== 2)
                            break;
                        message.plugin_context = reader.bytes();
                        continue;
                    }
                case 13: {
                        if (wireType !== 2)
                            break;
                        message.plugin_identity = reader.string();
                        continue;
                    }
                case 14: {
                        if (wireType !== 2)
                            break;
                        message.comment = reader.string();
                        continue;
                    }
                case 15: {
                        if (wireType !== 2)
                            break;
                        message.hash = reader.string();
                        continue;
                    }
                case 16: {
                        if (wireType !== 2)
                            break;
                        message.comment_hash = reader.bytes();
                        continue;
                    }
                case 17: {
                        if (wireType !== 2)
                            break;
                        message.texture_hash = reader.bytes();
                        continue;
                    }
                case 18: {
                        if (wireType !== 0)
                            break;
                        message.priority_speaker = reader.bool();
                        continue;
                    }
                case 19: {
                        if (wireType !== 0)
                            break;
                        message.recording = reader.bool();
                        continue;
                    }
                case 20: {
                        if (wireType !== 2)
                            break;
                        if (!(message.temporary_access_tokens && message.temporary_access_tokens.length))
                            message.temporary_access_tokens = [];
                        message.temporary_access_tokens.push(reader.string());
                        continue;
                    }
                case 21: {
                        if (wireType === 2) {
                            if (!(message.listening_channel_add && message.listening_channel_add.length))
                                message.listening_channel_add = [];
                            reader.uint32s(message.listening_channel_add);
                            continue;
                        }
                        if (wireType !== 0)
                            break;
                        if (!(message.listening_channel_add && message.listening_channel_add.length))
                            message.listening_channel_add = [];
                        message.listening_channel_add.push(reader.uint32());
                        continue;
                    }
                case 22: {
                        if (wireType === 2) {
                            if (!(message.listening_channel_remove && message.listening_channel_remove.length))
                                message.listening_channel_remove = [];
                            reader.uint32s(message.listening_channel_remove);
                            continue;
                        }
                        if (wireType !== 0)
                            break;
                        if (!(message.listening_channel_remove && message.listening_channel_remove.length))
                            message.listening_channel_remove = [];
                        message.listening_channel_remove.push(reader.uint32());
                        continue;
                    }
                case 23: {
                        if (wireType !== 2)
                            break;
                        if (!(message.listening_volume_adjustment && message.listening_volume_adjustment.length))
                            message.listening_volume_adjustment = [];
                        message.listening_volume_adjustment.push($root.MumbleProto.UserState.VolumeAdjustment.decode(reader, reader.uint32(), $undefined, _depth + 1));
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

        UserState.verify = function (message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (message.session != null && $Object.hasOwnProperty.call(message, "session"))
                if (!$util.isInteger(message.session))
                    return "session: integer expected";
            if (message.actor != null && $Object.hasOwnProperty.call(message, "actor"))
                if (!$util.isInteger(message.actor))
                    return "actor: integer expected";
            if (message.name != null && $Object.hasOwnProperty.call(message, "name"))
                if (!$util.isString(message.name))
                    return "name: string expected";
            if (message.user_id != null && $Object.hasOwnProperty.call(message, "user_id"))
                if (!$util.isInteger(message.user_id))
                    return "user_id: integer expected";
            if (message.channel_id != null && $Object.hasOwnProperty.call(message, "channel_id"))
                if (!$util.isInteger(message.channel_id))
                    return "channel_id: integer expected";
            if (message.mute != null && $Object.hasOwnProperty.call(message, "mute"))
                if (typeof message.mute !== "boolean")
                    return "mute: boolean expected";
            if (message.deaf != null && $Object.hasOwnProperty.call(message, "deaf"))
                if (typeof message.deaf !== "boolean")
                    return "deaf: boolean expected";
            if (message.suppress != null && $Object.hasOwnProperty.call(message, "suppress"))
                if (typeof message.suppress !== "boolean")
                    return "suppress: boolean expected";
            if (message.self_mute != null && $Object.hasOwnProperty.call(message, "self_mute"))
                if (typeof message.self_mute !== "boolean")
                    return "self_mute: boolean expected";
            if (message.self_deaf != null && $Object.hasOwnProperty.call(message, "self_deaf"))
                if (typeof message.self_deaf !== "boolean")
                    return "self_deaf: boolean expected";
            if (message.texture != null && $Object.hasOwnProperty.call(message, "texture"))
                if (!(message.texture && typeof message.texture.length === "number" || $util.isString(message.texture)))
                    return "texture: buffer expected";
            if (message.plugin_context != null && $Object.hasOwnProperty.call(message, "plugin_context"))
                if (!(message.plugin_context && typeof message.plugin_context.length === "number" || $util.isString(message.plugin_context)))
                    return "plugin_context: buffer expected";
            if (message.plugin_identity != null && $Object.hasOwnProperty.call(message, "plugin_identity"))
                if (!$util.isString(message.plugin_identity))
                    return "plugin_identity: string expected";
            if (message.comment != null && $Object.hasOwnProperty.call(message, "comment"))
                if (!$util.isString(message.comment))
                    return "comment: string expected";
            if (message.hash != null && $Object.hasOwnProperty.call(message, "hash"))
                if (!$util.isString(message.hash))
                    return "hash: string expected";
            if (message.comment_hash != null && $Object.hasOwnProperty.call(message, "comment_hash"))
                if (!(message.comment_hash && typeof message.comment_hash.length === "number" || $util.isString(message.comment_hash)))
                    return "comment_hash: buffer expected";
            if (message.texture_hash != null && $Object.hasOwnProperty.call(message, "texture_hash"))
                if (!(message.texture_hash && typeof message.texture_hash.length === "number" || $util.isString(message.texture_hash)))
                    return "texture_hash: buffer expected";
            if (message.priority_speaker != null && $Object.hasOwnProperty.call(message, "priority_speaker"))
                if (typeof message.priority_speaker !== "boolean")
                    return "priority_speaker: boolean expected";
            if (message.recording != null && $Object.hasOwnProperty.call(message, "recording"))
                if (typeof message.recording !== "boolean")
                    return "recording: boolean expected";
            if (message.temporary_access_tokens != null && $Object.hasOwnProperty.call(message, "temporary_access_tokens")) {
                if (!$Array.isArray(message.temporary_access_tokens))
                    return "temporary_access_tokens: array expected";
                for (let i = 0; i < message.temporary_access_tokens.length; ++i)
                    if (!$util.isString(message.temporary_access_tokens[i]))
                        return "temporary_access_tokens: string[] expected";
            }
            if (message.listening_channel_add != null && $Object.hasOwnProperty.call(message, "listening_channel_add")) {
                if (!$Array.isArray(message.listening_channel_add))
                    return "listening_channel_add: array expected";
                for (let i = 0; i < message.listening_channel_add.length; ++i)
                    if (!$util.isInteger(message.listening_channel_add[i]))
                        return "listening_channel_add: integer[] expected";
            }
            if (message.listening_channel_remove != null && $Object.hasOwnProperty.call(message, "listening_channel_remove")) {
                if (!$Array.isArray(message.listening_channel_remove))
                    return "listening_channel_remove: array expected";
                for (let i = 0; i < message.listening_channel_remove.length; ++i)
                    if (!$util.isInteger(message.listening_channel_remove[i]))
                        return "listening_channel_remove: integer[] expected";
            }
            if (message.listening_volume_adjustment != null && $Object.hasOwnProperty.call(message, "listening_volume_adjustment")) {
                if (!$Array.isArray(message.listening_volume_adjustment))
                    return "listening_volume_adjustment: array expected";
                for (let i = 0; i < message.listening_volume_adjustment.length; ++i) {
                    let error = $root.MumbleProto.UserState.VolumeAdjustment.verify(message.listening_volume_adjustment[i], _depth + 1);
                    if (error)
                        return "listening_volume_adjustment." + error;
                }
            }
            return null;
        };

        UserState.fromObject = function (object, _depth) {
            if (object instanceof $root.MumbleProto.UserState)
                return object;
            if (!$util.isObject(object))
                throw $TypeError(".MumbleProto.UserState: object expected");
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let message = new $root.MumbleProto.UserState();
            if (object.session != null)
                message.session = object.session >>> 0;
            if (object.actor != null)
                message.actor = object.actor >>> 0;
            if (object.name != null)
                message.name = $String(object.name);
            if (object.user_id != null)
                message.user_id = object.user_id >>> 0;
            if (object.channel_id != null)
                message.channel_id = object.channel_id >>> 0;
            if (object.mute != null)
                message.mute = $Boolean(object.mute);
            if (object.deaf != null)
                message.deaf = $Boolean(object.deaf);
            if (object.suppress != null)
                message.suppress = $Boolean(object.suppress);
            if (object.self_mute != null)
                message.self_mute = $Boolean(object.self_mute);
            if (object.self_deaf != null)
                message.self_deaf = $Boolean(object.self_deaf);
            if (object.texture != null)
                if (typeof object.texture === "string")
                    $util.base64.decode(object.texture, message.texture = $util.newBuffer($util.base64.length(object.texture)), 0);
                else if (object.texture.length >= 0)
                    message.texture = object.texture;
            if (object.plugin_context != null)
                if (typeof object.plugin_context === "string")
                    $util.base64.decode(object.plugin_context, message.plugin_context = $util.newBuffer($util.base64.length(object.plugin_context)), 0);
                else if (object.plugin_context.length >= 0)
                    message.plugin_context = object.plugin_context;
            if (object.plugin_identity != null)
                message.plugin_identity = $String(object.plugin_identity);
            if (object.comment != null)
                message.comment = $String(object.comment);
            if (object.hash != null)
                message.hash = $String(object.hash);
            if (object.comment_hash != null)
                if (typeof object.comment_hash === "string")
                    $util.base64.decode(object.comment_hash, message.comment_hash = $util.newBuffer($util.base64.length(object.comment_hash)), 0);
                else if (object.comment_hash.length >= 0)
                    message.comment_hash = object.comment_hash;
            if (object.texture_hash != null)
                if (typeof object.texture_hash === "string")
                    $util.base64.decode(object.texture_hash, message.texture_hash = $util.newBuffer($util.base64.length(object.texture_hash)), 0);
                else if (object.texture_hash.length >= 0)
                    message.texture_hash = object.texture_hash;
            if (object.priority_speaker != null)
                message.priority_speaker = $Boolean(object.priority_speaker);
            if (object.recording != null)
                message.recording = $Boolean(object.recording);
            if (object.temporary_access_tokens) {
                if (!$Array.isArray(object.temporary_access_tokens))
                    throw $TypeError(".MumbleProto.UserState.temporary_access_tokens: array expected");
                message.temporary_access_tokens = $Array(object.temporary_access_tokens.length);
                for (let i = 0; i < object.temporary_access_tokens.length; ++i)
                    message.temporary_access_tokens[i] = $String(object.temporary_access_tokens[i]);
            }
            if (object.listening_channel_add) {
                if (!$Array.isArray(object.listening_channel_add))
                    throw $TypeError(".MumbleProto.UserState.listening_channel_add: array expected");
                message.listening_channel_add = $Array(object.listening_channel_add.length);
                for (let i = 0; i < object.listening_channel_add.length; ++i)
                    message.listening_channel_add[i] = object.listening_channel_add[i] >>> 0;
            }
            if (object.listening_channel_remove) {
                if (!$Array.isArray(object.listening_channel_remove))
                    throw $TypeError(".MumbleProto.UserState.listening_channel_remove: array expected");
                message.listening_channel_remove = $Array(object.listening_channel_remove.length);
                for (let i = 0; i < object.listening_channel_remove.length; ++i)
                    message.listening_channel_remove[i] = object.listening_channel_remove[i] >>> 0;
            }
            if (object.listening_volume_adjustment) {
                if (!$Array.isArray(object.listening_volume_adjustment))
                    throw $TypeError(".MumbleProto.UserState.listening_volume_adjustment: array expected");
                message.listening_volume_adjustment = $Array(object.listening_volume_adjustment.length);
                for (let i = 0; i < object.listening_volume_adjustment.length; ++i) {
                    if (!$util.isObject(object.listening_volume_adjustment[i]))
                        throw $TypeError(".MumbleProto.UserState.listening_volume_adjustment: object expected");
                    message.listening_volume_adjustment[i] = $root.MumbleProto.UserState.VolumeAdjustment.fromObject(object.listening_volume_adjustment[i], _depth + 1);
                }
            }
            return message;
        };

        UserState.toObject = function (message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let object = {};
            if (options.arrays || options.defaults) {
                object.temporary_access_tokens = [];
                object.listening_channel_add = [];
                object.listening_channel_remove = [];
                object.listening_volume_adjustment = [];
            }
            if (options.defaults) {
                object.session = 0;
                object.actor = 0;
                object.name = "";
                object.user_id = 0;
                object.channel_id = 0;
                object.mute = false;
                object.deaf = false;
                object.suppress = false;
                object.self_mute = false;
                object.self_deaf = false;
                if (options.bytes === $String)
                    object.texture = "";
                else {
                    object.texture = [];
                    if (options.bytes !== $Array)
                        object.texture = $util.newBuffer(object.texture);
                }
                if (options.bytes === $String)
                    object.plugin_context = "";
                else {
                    object.plugin_context = [];
                    if (options.bytes !== $Array)
                        object.plugin_context = $util.newBuffer(object.plugin_context);
                }
                object.plugin_identity = "";
                object.comment = "";
                object.hash = "";
                if (options.bytes === $String)
                    object.comment_hash = "";
                else {
                    object.comment_hash = [];
                    if (options.bytes !== $Array)
                        object.comment_hash = $util.newBuffer(object.comment_hash);
                }
                if (options.bytes === $String)
                    object.texture_hash = "";
                else {
                    object.texture_hash = [];
                    if (options.bytes !== $Array)
                        object.texture_hash = $util.newBuffer(object.texture_hash);
                }
                object.priority_speaker = false;
                object.recording = false;
            }
            if (message.session != null && $Object.hasOwnProperty.call(message, "session"))
                object.session = message.session;
            if (message.actor != null && $Object.hasOwnProperty.call(message, "actor"))
                object.actor = message.actor;
            if (message.name != null && $Object.hasOwnProperty.call(message, "name"))
                object.name = message.name;
            if (message.user_id != null && $Object.hasOwnProperty.call(message, "user_id"))
                object.user_id = message.user_id;
            if (message.channel_id != null && $Object.hasOwnProperty.call(message, "channel_id"))
                object.channel_id = message.channel_id;
            if (message.mute != null && $Object.hasOwnProperty.call(message, "mute"))
                object.mute = message.mute;
            if (message.deaf != null && $Object.hasOwnProperty.call(message, "deaf"))
                object.deaf = message.deaf;
            if (message.suppress != null && $Object.hasOwnProperty.call(message, "suppress"))
                object.suppress = message.suppress;
            if (message.self_mute != null && $Object.hasOwnProperty.call(message, "self_mute"))
                object.self_mute = message.self_mute;
            if (message.self_deaf != null && $Object.hasOwnProperty.call(message, "self_deaf"))
                object.self_deaf = message.self_deaf;
            if (message.texture != null && $Object.hasOwnProperty.call(message, "texture"))
                object.texture = options.bytes === $String ? $util.base64.encode(message.texture, 0, message.texture.length) : options.bytes === $Array ? $Array.prototype.slice.call(message.texture) : message.texture;
            if (message.plugin_context != null && $Object.hasOwnProperty.call(message, "plugin_context"))
                object.plugin_context = options.bytes === $String ? $util.base64.encode(message.plugin_context, 0, message.plugin_context.length) : options.bytes === $Array ? $Array.prototype.slice.call(message.plugin_context) : message.plugin_context;
            if (message.plugin_identity != null && $Object.hasOwnProperty.call(message, "plugin_identity"))
                object.plugin_identity = message.plugin_identity;
            if (message.comment != null && $Object.hasOwnProperty.call(message, "comment"))
                object.comment = message.comment;
            if (message.hash != null && $Object.hasOwnProperty.call(message, "hash"))
                object.hash = message.hash;
            if (message.comment_hash != null && $Object.hasOwnProperty.call(message, "comment_hash"))
                object.comment_hash = options.bytes === $String ? $util.base64.encode(message.comment_hash, 0, message.comment_hash.length) : options.bytes === $Array ? $Array.prototype.slice.call(message.comment_hash) : message.comment_hash;
            if (message.texture_hash != null && $Object.hasOwnProperty.call(message, "texture_hash"))
                object.texture_hash = options.bytes === $String ? $util.base64.encode(message.texture_hash, 0, message.texture_hash.length) : options.bytes === $Array ? $Array.prototype.slice.call(message.texture_hash) : message.texture_hash;
            if (message.priority_speaker != null && $Object.hasOwnProperty.call(message, "priority_speaker"))
                object.priority_speaker = message.priority_speaker;
            if (message.recording != null && $Object.hasOwnProperty.call(message, "recording"))
                object.recording = message.recording;
            if (message.temporary_access_tokens && message.temporary_access_tokens.length) {
                object.temporary_access_tokens = $Array(message.temporary_access_tokens.length);
                for (let j = 0; j < message.temporary_access_tokens.length; ++j)
                    object.temporary_access_tokens[j] = message.temporary_access_tokens[j];
            }
            if (message.listening_channel_add && message.listening_channel_add.length) {
                object.listening_channel_add = $Array(message.listening_channel_add.length);
                for (let j = 0; j < message.listening_channel_add.length; ++j)
                    object.listening_channel_add[j] = message.listening_channel_add[j];
            }
            if (message.listening_channel_remove && message.listening_channel_remove.length) {
                object.listening_channel_remove = $Array(message.listening_channel_remove.length);
                for (let j = 0; j < message.listening_channel_remove.length; ++j)
                    object.listening_channel_remove[j] = message.listening_channel_remove[j];
            }
            if (message.listening_volume_adjustment && message.listening_volume_adjustment.length) {
                object.listening_volume_adjustment = $Array(message.listening_volume_adjustment.length);
                for (let j = 0; j < message.listening_volume_adjustment.length; ++j)
                    object.listening_volume_adjustment[j] = $root.MumbleProto.UserState.VolumeAdjustment.toObject(message.listening_volume_adjustment[j], options, _depth + 1);
            }
            return object;
        };

        UserState.prototype.toJSON = function() {
            return UserState.toObject(this, $protobuf.util.toJSONOptions);
        };

        UserState.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/MumbleProto.UserState";
        };

        UserState.VolumeAdjustment = (function() {

            const VolumeAdjustment = function (properties) {
                if (properties)
                    for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null && keys[i] !== "__proto__")
                            this[keys[i]] = properties[keys[i]];
            };

            VolumeAdjustment.prototype.listening_channel = 0;
            VolumeAdjustment.prototype.volume_adjustment = 0;

            VolumeAdjustment.create = function(properties) {
                return new VolumeAdjustment(properties);
            };

            VolumeAdjustment.encode = function (message, writer, _depth) {
                if (!writer)
                    writer = $Writer.create();
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (message.listening_channel != null && $Object.hasOwnProperty.call(message, "listening_channel"))
                    writer.uint32(8).uint32(message.listening_channel);
                if (message.volume_adjustment != null && $Object.hasOwnProperty.call(message, "volume_adjustment"))
                    writer.uint32(21).float(message.volume_adjustment);
                if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                    for (let i = 0; i < message.$unknowns.length; ++i)
                        writer.raw(message.$unknowns[i]);
                return writer;
            };

            VolumeAdjustment.decode = function (reader, length, _end, _depth, _target) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                let end, message;
                if (length === $undefined)
                    end = reader.len;
                else {
                    end = reader.pos + length;
                    if (end > reader.len)
                        throw $RangeError("index out of range");
                    length = reader.len;
                    reader.len = end;
                }
                message = _target || new $root.MumbleProto.UserState.VolumeAdjustment();
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
                            message.listening_channel = reader.uint32();
                            continue;
                        }
                    case 2: {
                            if (wireType !== 5)
                                break;
                            message.volume_adjustment = reader.float();
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

            VolumeAdjustment.verify = function (message, _depth) {
                if (typeof message !== "object" || message === null)
                    return "object expected";
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    return "max depth exceeded";
                if (message.listening_channel != null && $Object.hasOwnProperty.call(message, "listening_channel"))
                    if (!$util.isInteger(message.listening_channel))
                        return "listening_channel: integer expected";
                if (message.volume_adjustment != null && $Object.hasOwnProperty.call(message, "volume_adjustment"))
                    if (typeof message.volume_adjustment !== "number")
                        return "volume_adjustment: number expected";
                return null;
            };

            VolumeAdjustment.fromObject = function (object, _depth) {
                if (object instanceof $root.MumbleProto.UserState.VolumeAdjustment)
                    return object;
                if (!$util.isObject(object))
                    throw $TypeError(".MumbleProto.UserState.VolumeAdjustment: object expected");
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                let message = new $root.MumbleProto.UserState.VolumeAdjustment();
                if (object.listening_channel != null)
                    message.listening_channel = object.listening_channel >>> 0;
                if (object.volume_adjustment != null)
                    message.volume_adjustment = $Number(object.volume_adjustment);
                return message;
            };

            VolumeAdjustment.toObject = function (message, options, _depth) {
                if (!options)
                    options = {};
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                let object = {};
                if (options.defaults) {
                    object.listening_channel = 0;
                    object.volume_adjustment = 0;
                }
                if (message.listening_channel != null && $Object.hasOwnProperty.call(message, "listening_channel"))
                    object.listening_channel = message.listening_channel;
                if (message.volume_adjustment != null && $Object.hasOwnProperty.call(message, "volume_adjustment"))
                    object.volume_adjustment = options.json && !$isFinite(message.volume_adjustment) ? $String(message.volume_adjustment) : message.volume_adjustment;
                return object;
            };

            VolumeAdjustment.prototype.toJSON = function() {
                return VolumeAdjustment.toObject(this, $protobuf.util.toJSONOptions);
            };

            VolumeAdjustment.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/MumbleProto.UserState.VolumeAdjustment";
            };

            return VolumeAdjustment;
        })();

        return UserState;
    })();

    MumbleProto.BanList = (function() {

        const BanList = function (properties) {
            this.bans = [];
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        BanList.prototype.bans = $util.emptyArray;
        BanList.prototype.query = false;

        BanList.create = function(properties) {
            return new BanList(properties);
        };

        BanList.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.bans != null && message.bans.length)
                for (let i = 0; i < message.bans.length; ++i)
                    $root.MumbleProto.BanList.BanEntry.encode(message.bans[i], writer.uint32(10).fork(), _depth + 1).ldelim();
            if (message.query != null && $Object.hasOwnProperty.call(message, "query"))
                writer.uint32(16).bool(message.query);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        BanList.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end, message;
            if (length === $undefined)
                end = reader.len;
            else {
                end = reader.pos + length;
                if (end > reader.len)
                    throw $RangeError("index out of range");
                length = reader.len;
                reader.len = end;
            }
            message = _target || new $root.MumbleProto.BanList();
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
                        if (wireType !== 2)
                            break;
                        if (!(message.bans && message.bans.length))
                            message.bans = [];
                        message.bans.push($root.MumbleProto.BanList.BanEntry.decode(reader, reader.uint32(), $undefined, _depth + 1));
                        continue;
                    }
                case 2: {
                        if (wireType !== 0)
                            break;
                        message.query = reader.bool();
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

        BanList.verify = function (message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (message.bans != null && $Object.hasOwnProperty.call(message, "bans")) {
                if (!$Array.isArray(message.bans))
                    return "bans: array expected";
                for (let i = 0; i < message.bans.length; ++i) {
                    let error = $root.MumbleProto.BanList.BanEntry.verify(message.bans[i], _depth + 1);
                    if (error)
                        return "bans." + error;
                }
            }
            if (message.query != null && $Object.hasOwnProperty.call(message, "query"))
                if (typeof message.query !== "boolean")
                    return "query: boolean expected";
            return null;
        };

        BanList.fromObject = function (object, _depth) {
            if (object instanceof $root.MumbleProto.BanList)
                return object;
            if (!$util.isObject(object))
                throw $TypeError(".MumbleProto.BanList: object expected");
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let message = new $root.MumbleProto.BanList();
            if (object.bans) {
                if (!$Array.isArray(object.bans))
                    throw $TypeError(".MumbleProto.BanList.bans: array expected");
                message.bans = $Array(object.bans.length);
                for (let i = 0; i < object.bans.length; ++i) {
                    if (!$util.isObject(object.bans[i]))
                        throw $TypeError(".MumbleProto.BanList.bans: object expected");
                    message.bans[i] = $root.MumbleProto.BanList.BanEntry.fromObject(object.bans[i], _depth + 1);
                }
            }
            if (object.query != null)
                message.query = $Boolean(object.query);
            return message;
        };

        BanList.toObject = function (message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let object = {};
            if (options.arrays || options.defaults)
                object.bans = [];
            if (options.defaults)
                object.query = false;
            if (message.bans && message.bans.length) {
                object.bans = $Array(message.bans.length);
                for (let j = 0; j < message.bans.length; ++j)
                    object.bans[j] = $root.MumbleProto.BanList.BanEntry.toObject(message.bans[j], options, _depth + 1);
            }
            if (message.query != null && $Object.hasOwnProperty.call(message, "query"))
                object.query = message.query;
            return object;
        };

        BanList.prototype.toJSON = function() {
            return BanList.toObject(this, $protobuf.util.toJSONOptions);
        };

        BanList.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/MumbleProto.BanList";
        };

        BanList.BanEntry = (function() {

            const BanEntry = function (properties) {
                if (properties)
                    for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null && keys[i] !== "__proto__")
                            this[keys[i]] = properties[keys[i]];
            };

            BanEntry.prototype.address = $util.newBuffer([]);
            BanEntry.prototype.mask = 0;
            BanEntry.prototype.name = "";
            BanEntry.prototype.hash = "";
            BanEntry.prototype.reason = "";
            BanEntry.prototype.start = "";
            BanEntry.prototype.duration = 0;

            BanEntry.create = function(properties) {
                return new BanEntry(properties);
            };

            BanEntry.encode = function (message, writer, _depth) {
                if (!writer)
                    writer = $Writer.create();
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                writer.uint32(10).bytes(message.address);
                writer.uint32(16).uint32(message.mask);
                if (message.name != null && $Object.hasOwnProperty.call(message, "name"))
                    writer.uint32(26).string(message.name);
                if (message.hash != null && $Object.hasOwnProperty.call(message, "hash"))
                    writer.uint32(34).string(message.hash);
                if (message.reason != null && $Object.hasOwnProperty.call(message, "reason"))
                    writer.uint32(42).string(message.reason);
                if (message.start != null && $Object.hasOwnProperty.call(message, "start"))
                    writer.uint32(50).string(message.start);
                if (message.duration != null && $Object.hasOwnProperty.call(message, "duration"))
                    writer.uint32(56).uint32(message.duration);
                if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                    for (let i = 0; i < message.$unknowns.length; ++i)
                        writer.raw(message.$unknowns[i]);
                return writer;
            };

            BanEntry.decode = function (reader, length, _end, _depth, _target) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                let end, message;
                if (length === $undefined)
                    end = reader.len;
                else {
                    end = reader.pos + length;
                    if (end > reader.len)
                        throw $RangeError("index out of range");
                    length = reader.len;
                    reader.len = end;
                }
                message = _target || new $root.MumbleProto.BanList.BanEntry();
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
                            if (wireType !== 2)
                                break;
                            message.address = reader.bytes();
                            continue;
                        }
                    case 2: {
                            if (wireType !== 0)
                                break;
                            message.mask = reader.uint32();
                            continue;
                        }
                    case 3: {
                            if (wireType !== 2)
                                break;
                            message.name = reader.string();
                            continue;
                        }
                    case 4: {
                            if (wireType !== 2)
                                break;
                            message.hash = reader.string();
                            continue;
                        }
                    case 5: {
                            if (wireType !== 2)
                                break;
                            message.reason = reader.string();
                            continue;
                        }
                    case 6: {
                            if (wireType !== 2)
                                break;
                            message.start = reader.string();
                            continue;
                        }
                    case 7: {
                            if (wireType !== 0)
                                break;
                            message.duration = reader.uint32();
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
                if (!$Object.hasOwnProperty.call(message, "address"))
                    throw $util.ProtocolError("missing required 'address'", { instance: message });
                if (!$Object.hasOwnProperty.call(message, "mask"))
                    throw $util.ProtocolError("missing required 'mask'", { instance: message });
                return message;
            };

            BanEntry.verify = function (message, _depth) {
                if (typeof message !== "object" || message === null)
                    return "object expected";
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    return "max depth exceeded";
                if (!(message.address && typeof message.address.length === "number" || $util.isString(message.address)))
                    return "address: buffer expected";
                if (!$util.isInteger(message.mask))
                    return "mask: integer expected";
                if (message.name != null && $Object.hasOwnProperty.call(message, "name"))
                    if (!$util.isString(message.name))
                        return "name: string expected";
                if (message.hash != null && $Object.hasOwnProperty.call(message, "hash"))
                    if (!$util.isString(message.hash))
                        return "hash: string expected";
                if (message.reason != null && $Object.hasOwnProperty.call(message, "reason"))
                    if (!$util.isString(message.reason))
                        return "reason: string expected";
                if (message.start != null && $Object.hasOwnProperty.call(message, "start"))
                    if (!$util.isString(message.start))
                        return "start: string expected";
                if (message.duration != null && $Object.hasOwnProperty.call(message, "duration"))
                    if (!$util.isInteger(message.duration))
                        return "duration: integer expected";
                return null;
            };

            BanEntry.fromObject = function (object, _depth) {
                if (object instanceof $root.MumbleProto.BanList.BanEntry)
                    return object;
                if (!$util.isObject(object))
                    throw $TypeError(".MumbleProto.BanList.BanEntry: object expected");
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                let message = new $root.MumbleProto.BanList.BanEntry();
                if (object.address != null)
                    if (typeof object.address === "string")
                        $util.base64.decode(object.address, message.address = $util.newBuffer($util.base64.length(object.address)), 0);
                    else if (object.address.length >= 0)
                        message.address = object.address;
                if (object.mask != null)
                    message.mask = object.mask >>> 0;
                if (object.name != null)
                    message.name = $String(object.name);
                if (object.hash != null)
                    message.hash = $String(object.hash);
                if (object.reason != null)
                    message.reason = $String(object.reason);
                if (object.start != null)
                    message.start = $String(object.start);
                if (object.duration != null)
                    message.duration = object.duration >>> 0;
                return message;
            };

            BanEntry.toObject = function (message, options, _depth) {
                if (!options)
                    options = {};
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                let object = {};
                if (options.defaults) {
                    if (options.bytes === $String)
                        object.address = "";
                    else {
                        object.address = [];
                        if (options.bytes !== $Array)
                            object.address = $util.newBuffer(object.address);
                    }
                    object.mask = 0;
                    object.name = "";
                    object.hash = "";
                    object.reason = "";
                    object.start = "";
                    object.duration = 0;
                }
                if (message.address != null && $Object.hasOwnProperty.call(message, "address"))
                    object.address = options.bytes === $String ? $util.base64.encode(message.address, 0, message.address.length) : options.bytes === $Array ? $Array.prototype.slice.call(message.address) : message.address;
                if (message.mask != null && $Object.hasOwnProperty.call(message, "mask"))
                    object.mask = message.mask;
                if (message.name != null && $Object.hasOwnProperty.call(message, "name"))
                    object.name = message.name;
                if (message.hash != null && $Object.hasOwnProperty.call(message, "hash"))
                    object.hash = message.hash;
                if (message.reason != null && $Object.hasOwnProperty.call(message, "reason"))
                    object.reason = message.reason;
                if (message.start != null && $Object.hasOwnProperty.call(message, "start"))
                    object.start = message.start;
                if (message.duration != null && $Object.hasOwnProperty.call(message, "duration"))
                    object.duration = message.duration;
                return object;
            };

            BanEntry.prototype.toJSON = function() {
                return BanEntry.toObject(this, $protobuf.util.toJSONOptions);
            };

            BanEntry.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/MumbleProto.BanList.BanEntry";
            };

            return BanEntry;
        })();

        return BanList;
    })();

    MumbleProto.TextMessage = (function() {

        const TextMessage = function (properties) {
            this.session = [];
            this.channel_id = [];
            this.tree_id = [];
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        TextMessage.prototype.actor = 0;
        TextMessage.prototype.session = $util.emptyArray;
        TextMessage.prototype.channel_id = $util.emptyArray;
        TextMessage.prototype.tree_id = $util.emptyArray;
        TextMessage.prototype.message = "";

        TextMessage.create = function(properties) {
            return new TextMessage(properties);
        };

        TextMessage.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.actor != null && $Object.hasOwnProperty.call(message, "actor"))
                writer.uint32(8).uint32(message.actor);
            if (message.session != null && message.session.length)
                for (let i = 0; i < message.session.length; ++i)
                    writer.uint32(16).uint32(message.session[i]);
            if (message.channel_id != null && message.channel_id.length)
                for (let i = 0; i < message.channel_id.length; ++i)
                    writer.uint32(24).uint32(message.channel_id[i]);
            if (message.tree_id != null && message.tree_id.length)
                for (let i = 0; i < message.tree_id.length; ++i)
                    writer.uint32(32).uint32(message.tree_id[i]);
            writer.uint32(42).string(message.message);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        TextMessage.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end, message;
            if (length === $undefined)
                end = reader.len;
            else {
                end = reader.pos + length;
                if (end > reader.len)
                    throw $RangeError("index out of range");
                length = reader.len;
                reader.len = end;
            }
            message = _target || new $root.MumbleProto.TextMessage();
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
                        message.actor = reader.uint32();
                        continue;
                    }
                case 2: {
                        if (wireType === 2) {
                            if (!(message.session && message.session.length))
                                message.session = [];
                            reader.uint32s(message.session);
                            continue;
                        }
                        if (wireType !== 0)
                            break;
                        if (!(message.session && message.session.length))
                            message.session = [];
                        message.session.push(reader.uint32());
                        continue;
                    }
                case 3: {
                        if (wireType === 2) {
                            if (!(message.channel_id && message.channel_id.length))
                                message.channel_id = [];
                            reader.uint32s(message.channel_id);
                            continue;
                        }
                        if (wireType !== 0)
                            break;
                        if (!(message.channel_id && message.channel_id.length))
                            message.channel_id = [];
                        message.channel_id.push(reader.uint32());
                        continue;
                    }
                case 4: {
                        if (wireType === 2) {
                            if (!(message.tree_id && message.tree_id.length))
                                message.tree_id = [];
                            reader.uint32s(message.tree_id);
                            continue;
                        }
                        if (wireType !== 0)
                            break;
                        if (!(message.tree_id && message.tree_id.length))
                            message.tree_id = [];
                        message.tree_id.push(reader.uint32());
                        continue;
                    }
                case 5: {
                        if (wireType !== 2)
                            break;
                        message.message = reader.string();
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
            if (!$Object.hasOwnProperty.call(message, "message"))
                throw $util.ProtocolError("missing required 'message'", { instance: message });
            return message;
        };

        TextMessage.verify = function (message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (message.actor != null && $Object.hasOwnProperty.call(message, "actor"))
                if (!$util.isInteger(message.actor))
                    return "actor: integer expected";
            if (message.session != null && $Object.hasOwnProperty.call(message, "session")) {
                if (!$Array.isArray(message.session))
                    return "session: array expected";
                for (let i = 0; i < message.session.length; ++i)
                    if (!$util.isInteger(message.session[i]))
                        return "session: integer[] expected";
            }
            if (message.channel_id != null && $Object.hasOwnProperty.call(message, "channel_id")) {
                if (!$Array.isArray(message.channel_id))
                    return "channel_id: array expected";
                for (let i = 0; i < message.channel_id.length; ++i)
                    if (!$util.isInteger(message.channel_id[i]))
                        return "channel_id: integer[] expected";
            }
            if (message.tree_id != null && $Object.hasOwnProperty.call(message, "tree_id")) {
                if (!$Array.isArray(message.tree_id))
                    return "tree_id: array expected";
                for (let i = 0; i < message.tree_id.length; ++i)
                    if (!$util.isInteger(message.tree_id[i]))
                        return "tree_id: integer[] expected";
            }
            if (!$util.isString(message.message))
                return "message: string expected";
            return null;
        };

        TextMessage.fromObject = function (object, _depth) {
            if (object instanceof $root.MumbleProto.TextMessage)
                return object;
            if (!$util.isObject(object))
                throw $TypeError(".MumbleProto.TextMessage: object expected");
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let message = new $root.MumbleProto.TextMessage();
            if (object.actor != null)
                message.actor = object.actor >>> 0;
            if (object.session) {
                if (!$Array.isArray(object.session))
                    throw $TypeError(".MumbleProto.TextMessage.session: array expected");
                message.session = $Array(object.session.length);
                for (let i = 0; i < object.session.length; ++i)
                    message.session[i] = object.session[i] >>> 0;
            }
            if (object.channel_id) {
                if (!$Array.isArray(object.channel_id))
                    throw $TypeError(".MumbleProto.TextMessage.channel_id: array expected");
                message.channel_id = $Array(object.channel_id.length);
                for (let i = 0; i < object.channel_id.length; ++i)
                    message.channel_id[i] = object.channel_id[i] >>> 0;
            }
            if (object.tree_id) {
                if (!$Array.isArray(object.tree_id))
                    throw $TypeError(".MumbleProto.TextMessage.tree_id: array expected");
                message.tree_id = $Array(object.tree_id.length);
                for (let i = 0; i < object.tree_id.length; ++i)
                    message.tree_id[i] = object.tree_id[i] >>> 0;
            }
            if (object.message != null)
                message.message = $String(object.message);
            return message;
        };

        TextMessage.toObject = function (message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let object = {};
            if (options.arrays || options.defaults) {
                object.session = [];
                object.channel_id = [];
                object.tree_id = [];
            }
            if (options.defaults) {
                object.actor = 0;
                object.message = "";
            }
            if (message.actor != null && $Object.hasOwnProperty.call(message, "actor"))
                object.actor = message.actor;
            if (message.session && message.session.length) {
                object.session = $Array(message.session.length);
                for (let j = 0; j < message.session.length; ++j)
                    object.session[j] = message.session[j];
            }
            if (message.channel_id && message.channel_id.length) {
                object.channel_id = $Array(message.channel_id.length);
                for (let j = 0; j < message.channel_id.length; ++j)
                    object.channel_id[j] = message.channel_id[j];
            }
            if (message.tree_id && message.tree_id.length) {
                object.tree_id = $Array(message.tree_id.length);
                for (let j = 0; j < message.tree_id.length; ++j)
                    object.tree_id[j] = message.tree_id[j];
            }
            if (message.message != null && $Object.hasOwnProperty.call(message, "message"))
                object.message = message.message;
            return object;
        };

        TextMessage.prototype.toJSON = function() {
            return TextMessage.toObject(this, $protobuf.util.toJSONOptions);
        };

        TextMessage.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/MumbleProto.TextMessage";
        };

        return TextMessage;
    })();

    MumbleProto.PermissionDenied = (function() {

        const PermissionDenied = function (properties) {
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        PermissionDenied.prototype.permission = 0;
        PermissionDenied.prototype.channel_id = 0;
        PermissionDenied.prototype.session = 0;
        PermissionDenied.prototype.reason = "";
        PermissionDenied.prototype.type = 0;
        PermissionDenied.prototype.name = "";

        PermissionDenied.create = function(properties) {
            return new PermissionDenied(properties);
        };

        PermissionDenied.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.permission != null && $Object.hasOwnProperty.call(message, "permission"))
                writer.uint32(8).uint32(message.permission);
            if (message.channel_id != null && $Object.hasOwnProperty.call(message, "channel_id"))
                writer.uint32(16).uint32(message.channel_id);
            if (message.session != null && $Object.hasOwnProperty.call(message, "session"))
                writer.uint32(24).uint32(message.session);
            if (message.reason != null && $Object.hasOwnProperty.call(message, "reason"))
                writer.uint32(34).string(message.reason);
            if (message.type != null && $Object.hasOwnProperty.call(message, "type"))
                writer.uint32(40).int32(message.type);
            if (message.name != null && $Object.hasOwnProperty.call(message, "name"))
                writer.uint32(50).string(message.name);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        PermissionDenied.decode = function (reader, length, _end, _depth, _target) {
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
            message = _target || new $root.MumbleProto.PermissionDenied();
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
                        message.permission = reader.uint32();
                        continue;
                    }
                case 2: {
                        if (wireType !== 0)
                            break;
                        message.channel_id = reader.uint32();
                        continue;
                    }
                case 3: {
                        if (wireType !== 0)
                            break;
                        message.session = reader.uint32();
                        continue;
                    }
                case 4: {
                        if (wireType !== 2)
                            break;
                        message.reason = reader.string();
                        continue;
                    }
                case 5: {
                        if (wireType !== 0)
                            break;
                        value = reader.int32();
                        if ($root.MumbleProto.PermissionDenied.DenyType[value] !== $undefined)
                            message.type = value;
                        else if (!reader.discardUnknown) {
                            $util.makeProp(message, "$unknowns", false);
                            (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                        }
                        continue;
                    }
                case 6: {
                        if (wireType !== 2)
                            break;
                        message.name = reader.string();
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

        PermissionDenied.verify = function (message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (message.permission != null && $Object.hasOwnProperty.call(message, "permission"))
                if (!$util.isInteger(message.permission))
                    return "permission: integer expected";
            if (message.channel_id != null && $Object.hasOwnProperty.call(message, "channel_id"))
                if (!$util.isInteger(message.channel_id))
                    return "channel_id: integer expected";
            if (message.session != null && $Object.hasOwnProperty.call(message, "session"))
                if (!$util.isInteger(message.session))
                    return "session: integer expected";
            if (message.reason != null && $Object.hasOwnProperty.call(message, "reason"))
                if (!$util.isString(message.reason))
                    return "reason: string expected";
            if (message.type != null && $Object.hasOwnProperty.call(message, "type"))
                switch (message.type) {
                default:
                    return "type: enum value expected";
                case 0:
                case 1:
                case 2:
                case 3:
                case 4:
                case 5:
                case 6:
                case 7:
                case 8:
                case 9:
                case 10:
                case 11:
                case 12:
                case 13:
                    break;
                }
            if (message.name != null && $Object.hasOwnProperty.call(message, "name"))
                if (!$util.isString(message.name))
                    return "name: string expected";
            return null;
        };

        PermissionDenied.fromObject = function (object, _depth) {
            if (object instanceof $root.MumbleProto.PermissionDenied)
                return object;
            if (!$util.isObject(object))
                throw $TypeError(".MumbleProto.PermissionDenied: object expected");
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let message = new $root.MumbleProto.PermissionDenied();
            if (object.permission != null)
                message.permission = object.permission >>> 0;
            if (object.channel_id != null)
                message.channel_id = object.channel_id >>> 0;
            if (object.session != null)
                message.session = object.session >>> 0;
            if (object.reason != null)
                message.reason = $String(object.reason);
            switch (object.type) {
            case "Text":
            case 0:
                message.type = 0;
                break;
            case "Permission":
            case 1:
                message.type = 1;
                break;
            case "SuperUser":
            case 2:
                message.type = 2;
                break;
            case "ChannelName":
            case 3:
                message.type = 3;
                break;
            case "TextTooLong":
            case 4:
                message.type = 4;
                break;
            case "H9K":
            case 5:
                message.type = 5;
                break;
            case "TemporaryChannel":
            case 6:
                message.type = 6;
                break;
            case "MissingCertificate":
            case 7:
                message.type = 7;
                break;
            case "UserName":
            case 8:
                message.type = 8;
                break;
            case "ChannelFull":
            case 9:
                message.type = 9;
                break;
            case "NestingLimit":
            case 10:
                message.type = 10;
                break;
            case "ChannelCountLimit":
            case 11:
                message.type = 11;
                break;
            case "ChannelListenerLimit":
            case 12:
                message.type = 12;
                break;
            case "UserListenerLimit":
            case 13:
                message.type = 13;
                break;
            default:
            }
            if (object.name != null)
                message.name = $String(object.name);
            return message;
        };

        PermissionDenied.toObject = function (message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let object = {};
            if (options.defaults) {
                object.permission = 0;
                object.channel_id = 0;
                object.session = 0;
                object.reason = "";
                object.type = options.enums === $String ? "Text" : 0;
                object.name = "";
            }
            if (message.permission != null && $Object.hasOwnProperty.call(message, "permission"))
                object.permission = message.permission;
            if (message.channel_id != null && $Object.hasOwnProperty.call(message, "channel_id"))
                object.channel_id = message.channel_id;
            if (message.session != null && $Object.hasOwnProperty.call(message, "session"))
                object.session = message.session;
            if (message.reason != null && $Object.hasOwnProperty.call(message, "reason"))
                object.reason = message.reason;
            if (message.type != null && $Object.hasOwnProperty.call(message, "type"))
                object.type = options.enums === $String ? $root.MumbleProto.PermissionDenied.DenyType[message.type] === $undefined ? message.type : $root.MumbleProto.PermissionDenied.DenyType[message.type] : message.type;
            if (message.name != null && $Object.hasOwnProperty.call(message, "name"))
                object.name = message.name;
            return object;
        };

        PermissionDenied.prototype.toJSON = function() {
            return PermissionDenied.toObject(this, $protobuf.util.toJSONOptions);
        };

        PermissionDenied.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/MumbleProto.PermissionDenied";
        };

        PermissionDenied.DenyType = (function() {
            const valuesById = $Object.create(null), values = $Object.create(valuesById);
            values[valuesById[0] = "Text"] = 0;
            values[valuesById[1] = "Permission"] = 1;
            values[valuesById[2] = "SuperUser"] = 2;
            values[valuesById[3] = "ChannelName"] = 3;
            values[valuesById[4] = "TextTooLong"] = 4;
            values[valuesById[5] = "H9K"] = 5;
            values[valuesById[6] = "TemporaryChannel"] = 6;
            values[valuesById[7] = "MissingCertificate"] = 7;
            values[valuesById[8] = "UserName"] = 8;
            values[valuesById[9] = "ChannelFull"] = 9;
            values[valuesById[10] = "NestingLimit"] = 10;
            values[valuesById[11] = "ChannelCountLimit"] = 11;
            values[valuesById[12] = "ChannelListenerLimit"] = 12;
            values[valuesById[13] = "UserListenerLimit"] = 13;
            return values;
        })();

        return PermissionDenied;
    })();

    MumbleProto.ACL = (function() {

        const ACL = function (properties) {
            this.groups = [];
            this.acls = [];
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        ACL.prototype.channel_id = 0;
        ACL.prototype.inherit_acls = true;
        ACL.prototype.groups = $util.emptyArray;
        ACL.prototype.acls = $util.emptyArray;
        ACL.prototype.query = false;

        ACL.create = function(properties) {
            return new ACL(properties);
        };

        ACL.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            writer.uint32(8).uint32(message.channel_id);
            if (message.inherit_acls != null && $Object.hasOwnProperty.call(message, "inherit_acls"))
                writer.uint32(16).bool(message.inherit_acls);
            if (message.groups != null && message.groups.length)
                for (let i = 0; i < message.groups.length; ++i)
                    $root.MumbleProto.ACL.ChanGroup.encode(message.groups[i], writer.uint32(26).fork(), _depth + 1).ldelim();
            if (message.acls != null && message.acls.length)
                for (let i = 0; i < message.acls.length; ++i)
                    $root.MumbleProto.ACL.ChanACL.encode(message.acls[i], writer.uint32(34).fork(), _depth + 1).ldelim();
            if (message.query != null && $Object.hasOwnProperty.call(message, "query"))
                writer.uint32(40).bool(message.query);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        ACL.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end, message;
            if (length === $undefined)
                end = reader.len;
            else {
                end = reader.pos + length;
                if (end > reader.len)
                    throw $RangeError("index out of range");
                length = reader.len;
                reader.len = end;
            }
            message = _target || new $root.MumbleProto.ACL();
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
                        message.channel_id = reader.uint32();
                        continue;
                    }
                case 2: {
                        if (wireType !== 0)
                            break;
                        message.inherit_acls = reader.bool();
                        continue;
                    }
                case 3: {
                        if (wireType !== 2)
                            break;
                        if (!(message.groups && message.groups.length))
                            message.groups = [];
                        message.groups.push($root.MumbleProto.ACL.ChanGroup.decode(reader, reader.uint32(), $undefined, _depth + 1));
                        continue;
                    }
                case 4: {
                        if (wireType !== 2)
                            break;
                        if (!(message.acls && message.acls.length))
                            message.acls = [];
                        message.acls.push($root.MumbleProto.ACL.ChanACL.decode(reader, reader.uint32(), $undefined, _depth + 1));
                        continue;
                    }
                case 5: {
                        if (wireType !== 0)
                            break;
                        message.query = reader.bool();
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
            if (!$Object.hasOwnProperty.call(message, "channel_id"))
                throw $util.ProtocolError("missing required 'channel_id'", { instance: message });
            return message;
        };

        ACL.verify = function (message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (!$util.isInteger(message.channel_id))
                return "channel_id: integer expected";
            if (message.inherit_acls != null && $Object.hasOwnProperty.call(message, "inherit_acls"))
                if (typeof message.inherit_acls !== "boolean")
                    return "inherit_acls: boolean expected";
            if (message.groups != null && $Object.hasOwnProperty.call(message, "groups")) {
                if (!$Array.isArray(message.groups))
                    return "groups: array expected";
                for (let i = 0; i < message.groups.length; ++i) {
                    let error = $root.MumbleProto.ACL.ChanGroup.verify(message.groups[i], _depth + 1);
                    if (error)
                        return "groups." + error;
                }
            }
            if (message.acls != null && $Object.hasOwnProperty.call(message, "acls")) {
                if (!$Array.isArray(message.acls))
                    return "acls: array expected";
                for (let i = 0; i < message.acls.length; ++i) {
                    let error = $root.MumbleProto.ACL.ChanACL.verify(message.acls[i], _depth + 1);
                    if (error)
                        return "acls." + error;
                }
            }
            if (message.query != null && $Object.hasOwnProperty.call(message, "query"))
                if (typeof message.query !== "boolean")
                    return "query: boolean expected";
            return null;
        };

        ACL.fromObject = function (object, _depth) {
            if (object instanceof $root.MumbleProto.ACL)
                return object;
            if (!$util.isObject(object))
                throw $TypeError(".MumbleProto.ACL: object expected");
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let message = new $root.MumbleProto.ACL();
            if (object.channel_id != null)
                message.channel_id = object.channel_id >>> 0;
            if (object.inherit_acls != null)
                message.inherit_acls = $Boolean(object.inherit_acls);
            if (object.groups) {
                if (!$Array.isArray(object.groups))
                    throw $TypeError(".MumbleProto.ACL.groups: array expected");
                message.groups = $Array(object.groups.length);
                for (let i = 0; i < object.groups.length; ++i) {
                    if (!$util.isObject(object.groups[i]))
                        throw $TypeError(".MumbleProto.ACL.groups: object expected");
                    message.groups[i] = $root.MumbleProto.ACL.ChanGroup.fromObject(object.groups[i], _depth + 1);
                }
            }
            if (object.acls) {
                if (!$Array.isArray(object.acls))
                    throw $TypeError(".MumbleProto.ACL.acls: array expected");
                message.acls = $Array(object.acls.length);
                for (let i = 0; i < object.acls.length; ++i) {
                    if (!$util.isObject(object.acls[i]))
                        throw $TypeError(".MumbleProto.ACL.acls: object expected");
                    message.acls[i] = $root.MumbleProto.ACL.ChanACL.fromObject(object.acls[i], _depth + 1);
                }
            }
            if (object.query != null)
                message.query = $Boolean(object.query);
            return message;
        };

        ACL.toObject = function (message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let object = {};
            if (options.arrays || options.defaults) {
                object.groups = [];
                object.acls = [];
            }
            if (options.defaults) {
                object.channel_id = 0;
                object.inherit_acls = true;
                object.query = false;
            }
            if (message.channel_id != null && $Object.hasOwnProperty.call(message, "channel_id"))
                object.channel_id = message.channel_id;
            if (message.inherit_acls != null && $Object.hasOwnProperty.call(message, "inherit_acls"))
                object.inherit_acls = message.inherit_acls;
            if (message.groups && message.groups.length) {
                object.groups = $Array(message.groups.length);
                for (let j = 0; j < message.groups.length; ++j)
                    object.groups[j] = $root.MumbleProto.ACL.ChanGroup.toObject(message.groups[j], options, _depth + 1);
            }
            if (message.acls && message.acls.length) {
                object.acls = $Array(message.acls.length);
                for (let j = 0; j < message.acls.length; ++j)
                    object.acls[j] = $root.MumbleProto.ACL.ChanACL.toObject(message.acls[j], options, _depth + 1);
            }
            if (message.query != null && $Object.hasOwnProperty.call(message, "query"))
                object.query = message.query;
            return object;
        };

        ACL.prototype.toJSON = function() {
            return ACL.toObject(this, $protobuf.util.toJSONOptions);
        };

        ACL.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/MumbleProto.ACL";
        };

        ACL.ChanGroup = (function() {

            const ChanGroup = function (properties) {
                this.add = [];
                this.remove = [];
                this.inherited_members = [];
                if (properties)
                    for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null && keys[i] !== "__proto__")
                            this[keys[i]] = properties[keys[i]];
            };

            ChanGroup.prototype.name = "";
            ChanGroup.prototype.inherited = true;
            ChanGroup.prototype.inherit = true;
            ChanGroup.prototype.inheritable = true;
            ChanGroup.prototype.add = $util.emptyArray;
            ChanGroup.prototype.remove = $util.emptyArray;
            ChanGroup.prototype.inherited_members = $util.emptyArray;

            ChanGroup.create = function(properties) {
                return new ChanGroup(properties);
            };

            ChanGroup.encode = function (message, writer, _depth) {
                if (!writer)
                    writer = $Writer.create();
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                writer.uint32(10).string(message.name);
                if (message.inherited != null && $Object.hasOwnProperty.call(message, "inherited"))
                    writer.uint32(16).bool(message.inherited);
                if (message.inherit != null && $Object.hasOwnProperty.call(message, "inherit"))
                    writer.uint32(24).bool(message.inherit);
                if (message.inheritable != null && $Object.hasOwnProperty.call(message, "inheritable"))
                    writer.uint32(32).bool(message.inheritable);
                if (message.add != null && message.add.length)
                    for (let i = 0; i < message.add.length; ++i)
                        writer.uint32(40).uint32(message.add[i]);
                if (message.remove != null && message.remove.length)
                    for (let i = 0; i < message.remove.length; ++i)
                        writer.uint32(48).uint32(message.remove[i]);
                if (message.inherited_members != null && message.inherited_members.length)
                    for (let i = 0; i < message.inherited_members.length; ++i)
                        writer.uint32(56).uint32(message.inherited_members[i]);
                if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                    for (let i = 0; i < message.$unknowns.length; ++i)
                        writer.raw(message.$unknowns[i]);
                return writer;
            };

            ChanGroup.decode = function (reader, length, _end, _depth, _target) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                let end, message;
                if (length === $undefined)
                    end = reader.len;
                else {
                    end = reader.pos + length;
                    if (end > reader.len)
                        throw $RangeError("index out of range");
                    length = reader.len;
                    reader.len = end;
                }
                message = _target || new $root.MumbleProto.ACL.ChanGroup();
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
                            if (wireType !== 2)
                                break;
                            message.name = reader.string();
                            continue;
                        }
                    case 2: {
                            if (wireType !== 0)
                                break;
                            message.inherited = reader.bool();
                            continue;
                        }
                    case 3: {
                            if (wireType !== 0)
                                break;
                            message.inherit = reader.bool();
                            continue;
                        }
                    case 4: {
                            if (wireType !== 0)
                                break;
                            message.inheritable = reader.bool();
                            continue;
                        }
                    case 5: {
                            if (wireType === 2) {
                                if (!(message.add && message.add.length))
                                    message.add = [];
                                reader.uint32s(message.add);
                                continue;
                            }
                            if (wireType !== 0)
                                break;
                            if (!(message.add && message.add.length))
                                message.add = [];
                            message.add.push(reader.uint32());
                            continue;
                        }
                    case 6: {
                            if (wireType === 2) {
                                if (!(message.remove && message.remove.length))
                                    message.remove = [];
                                reader.uint32s(message.remove);
                                continue;
                            }
                            if (wireType !== 0)
                                break;
                            if (!(message.remove && message.remove.length))
                                message.remove = [];
                            message.remove.push(reader.uint32());
                            continue;
                        }
                    case 7: {
                            if (wireType === 2) {
                                if (!(message.inherited_members && message.inherited_members.length))
                                    message.inherited_members = [];
                                reader.uint32s(message.inherited_members);
                                continue;
                            }
                            if (wireType !== 0)
                                break;
                            if (!(message.inherited_members && message.inherited_members.length))
                                message.inherited_members = [];
                            message.inherited_members.push(reader.uint32());
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
                if (!$Object.hasOwnProperty.call(message, "name"))
                    throw $util.ProtocolError("missing required 'name'", { instance: message });
                return message;
            };

            ChanGroup.verify = function (message, _depth) {
                if (typeof message !== "object" || message === null)
                    return "object expected";
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    return "max depth exceeded";
                if (!$util.isString(message.name))
                    return "name: string expected";
                if (message.inherited != null && $Object.hasOwnProperty.call(message, "inherited"))
                    if (typeof message.inherited !== "boolean")
                        return "inherited: boolean expected";
                if (message.inherit != null && $Object.hasOwnProperty.call(message, "inherit"))
                    if (typeof message.inherit !== "boolean")
                        return "inherit: boolean expected";
                if (message.inheritable != null && $Object.hasOwnProperty.call(message, "inheritable"))
                    if (typeof message.inheritable !== "boolean")
                        return "inheritable: boolean expected";
                if (message.add != null && $Object.hasOwnProperty.call(message, "add")) {
                    if (!$Array.isArray(message.add))
                        return "add: array expected";
                    for (let i = 0; i < message.add.length; ++i)
                        if (!$util.isInteger(message.add[i]))
                            return "add: integer[] expected";
                }
                if (message.remove != null && $Object.hasOwnProperty.call(message, "remove")) {
                    if (!$Array.isArray(message.remove))
                        return "remove: array expected";
                    for (let i = 0; i < message.remove.length; ++i)
                        if (!$util.isInteger(message.remove[i]))
                            return "remove: integer[] expected";
                }
                if (message.inherited_members != null && $Object.hasOwnProperty.call(message, "inherited_members")) {
                    if (!$Array.isArray(message.inherited_members))
                        return "inherited_members: array expected";
                    for (let i = 0; i < message.inherited_members.length; ++i)
                        if (!$util.isInteger(message.inherited_members[i]))
                            return "inherited_members: integer[] expected";
                }
                return null;
            };

            ChanGroup.fromObject = function (object, _depth) {
                if (object instanceof $root.MumbleProto.ACL.ChanGroup)
                    return object;
                if (!$util.isObject(object))
                    throw $TypeError(".MumbleProto.ACL.ChanGroup: object expected");
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                let message = new $root.MumbleProto.ACL.ChanGroup();
                if (object.name != null)
                    message.name = $String(object.name);
                if (object.inherited != null)
                    message.inherited = $Boolean(object.inherited);
                if (object.inherit != null)
                    message.inherit = $Boolean(object.inherit);
                if (object.inheritable != null)
                    message.inheritable = $Boolean(object.inheritable);
                if (object.add) {
                    if (!$Array.isArray(object.add))
                        throw $TypeError(".MumbleProto.ACL.ChanGroup.add: array expected");
                    message.add = $Array(object.add.length);
                    for (let i = 0; i < object.add.length; ++i)
                        message.add[i] = object.add[i] >>> 0;
                }
                if (object.remove) {
                    if (!$Array.isArray(object.remove))
                        throw $TypeError(".MumbleProto.ACL.ChanGroup.remove: array expected");
                    message.remove = $Array(object.remove.length);
                    for (let i = 0; i < object.remove.length; ++i)
                        message.remove[i] = object.remove[i] >>> 0;
                }
                if (object.inherited_members) {
                    if (!$Array.isArray(object.inherited_members))
                        throw $TypeError(".MumbleProto.ACL.ChanGroup.inherited_members: array expected");
                    message.inherited_members = $Array(object.inherited_members.length);
                    for (let i = 0; i < object.inherited_members.length; ++i)
                        message.inherited_members[i] = object.inherited_members[i] >>> 0;
                }
                return message;
            };

            ChanGroup.toObject = function (message, options, _depth) {
                if (!options)
                    options = {};
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                let object = {};
                if (options.arrays || options.defaults) {
                    object.add = [];
                    object.remove = [];
                    object.inherited_members = [];
                }
                if (options.defaults) {
                    object.name = "";
                    object.inherited = true;
                    object.inherit = true;
                    object.inheritable = true;
                }
                if (message.name != null && $Object.hasOwnProperty.call(message, "name"))
                    object.name = message.name;
                if (message.inherited != null && $Object.hasOwnProperty.call(message, "inherited"))
                    object.inherited = message.inherited;
                if (message.inherit != null && $Object.hasOwnProperty.call(message, "inherit"))
                    object.inherit = message.inherit;
                if (message.inheritable != null && $Object.hasOwnProperty.call(message, "inheritable"))
                    object.inheritable = message.inheritable;
                if (message.add && message.add.length) {
                    object.add = $Array(message.add.length);
                    for (let j = 0; j < message.add.length; ++j)
                        object.add[j] = message.add[j];
                }
                if (message.remove && message.remove.length) {
                    object.remove = $Array(message.remove.length);
                    for (let j = 0; j < message.remove.length; ++j)
                        object.remove[j] = message.remove[j];
                }
                if (message.inherited_members && message.inherited_members.length) {
                    object.inherited_members = $Array(message.inherited_members.length);
                    for (let j = 0; j < message.inherited_members.length; ++j)
                        object.inherited_members[j] = message.inherited_members[j];
                }
                return object;
            };

            ChanGroup.prototype.toJSON = function() {
                return ChanGroup.toObject(this, $protobuf.util.toJSONOptions);
            };

            ChanGroup.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/MumbleProto.ACL.ChanGroup";
            };

            return ChanGroup;
        })();

        ACL.ChanACL = (function() {

            const ChanACL = function (properties) {
                if (properties)
                    for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null && keys[i] !== "__proto__")
                            this[keys[i]] = properties[keys[i]];
            };

            ChanACL.prototype.apply_here = true;
            ChanACL.prototype.apply_subs = true;
            ChanACL.prototype.inherited = true;
            ChanACL.prototype.user_id = 0;
            ChanACL.prototype.group = "";
            ChanACL.prototype.grant = 0;
            ChanACL.prototype.deny = 0;

            ChanACL.create = function(properties) {
                return new ChanACL(properties);
            };

            ChanACL.encode = function (message, writer, _depth) {
                if (!writer)
                    writer = $Writer.create();
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (message.apply_here != null && $Object.hasOwnProperty.call(message, "apply_here"))
                    writer.uint32(8).bool(message.apply_here);
                if (message.apply_subs != null && $Object.hasOwnProperty.call(message, "apply_subs"))
                    writer.uint32(16).bool(message.apply_subs);
                if (message.inherited != null && $Object.hasOwnProperty.call(message, "inherited"))
                    writer.uint32(24).bool(message.inherited);
                if (message.user_id != null && $Object.hasOwnProperty.call(message, "user_id"))
                    writer.uint32(32).uint32(message.user_id);
                if (message.group != null && $Object.hasOwnProperty.call(message, "group"))
                    writer.uint32(42).string(message.group);
                if (message.grant != null && $Object.hasOwnProperty.call(message, "grant"))
                    writer.uint32(48).uint32(message.grant);
                if (message.deny != null && $Object.hasOwnProperty.call(message, "deny"))
                    writer.uint32(56).uint32(message.deny);
                if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                    for (let i = 0; i < message.$unknowns.length; ++i)
                        writer.raw(message.$unknowns[i]);
                return writer;
            };

            ChanACL.decode = function (reader, length, _end, _depth, _target) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                let end, message;
                if (length === $undefined)
                    end = reader.len;
                else {
                    end = reader.pos + length;
                    if (end > reader.len)
                        throw $RangeError("index out of range");
                    length = reader.len;
                    reader.len = end;
                }
                message = _target || new $root.MumbleProto.ACL.ChanACL();
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
                            message.apply_here = reader.bool();
                            continue;
                        }
                    case 2: {
                            if (wireType !== 0)
                                break;
                            message.apply_subs = reader.bool();
                            continue;
                        }
                    case 3: {
                            if (wireType !== 0)
                                break;
                            message.inherited = reader.bool();
                            continue;
                        }
                    case 4: {
                            if (wireType !== 0)
                                break;
                            message.user_id = reader.uint32();
                            continue;
                        }
                    case 5: {
                            if (wireType !== 2)
                                break;
                            message.group = reader.string();
                            continue;
                        }
                    case 6: {
                            if (wireType !== 0)
                                break;
                            message.grant = reader.uint32();
                            continue;
                        }
                    case 7: {
                            if (wireType !== 0)
                                break;
                            message.deny = reader.uint32();
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

            ChanACL.verify = function (message, _depth) {
                if (typeof message !== "object" || message === null)
                    return "object expected";
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    return "max depth exceeded";
                if (message.apply_here != null && $Object.hasOwnProperty.call(message, "apply_here"))
                    if (typeof message.apply_here !== "boolean")
                        return "apply_here: boolean expected";
                if (message.apply_subs != null && $Object.hasOwnProperty.call(message, "apply_subs"))
                    if (typeof message.apply_subs !== "boolean")
                        return "apply_subs: boolean expected";
                if (message.inherited != null && $Object.hasOwnProperty.call(message, "inherited"))
                    if (typeof message.inherited !== "boolean")
                        return "inherited: boolean expected";
                if (message.user_id != null && $Object.hasOwnProperty.call(message, "user_id"))
                    if (!$util.isInteger(message.user_id))
                        return "user_id: integer expected";
                if (message.group != null && $Object.hasOwnProperty.call(message, "group"))
                    if (!$util.isString(message.group))
                        return "group: string expected";
                if (message.grant != null && $Object.hasOwnProperty.call(message, "grant"))
                    if (!$util.isInteger(message.grant))
                        return "grant: integer expected";
                if (message.deny != null && $Object.hasOwnProperty.call(message, "deny"))
                    if (!$util.isInteger(message.deny))
                        return "deny: integer expected";
                return null;
            };

            ChanACL.fromObject = function (object, _depth) {
                if (object instanceof $root.MumbleProto.ACL.ChanACL)
                    return object;
                if (!$util.isObject(object))
                    throw $TypeError(".MumbleProto.ACL.ChanACL: object expected");
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                let message = new $root.MumbleProto.ACL.ChanACL();
                if (object.apply_here != null)
                    message.apply_here = $Boolean(object.apply_here);
                if (object.apply_subs != null)
                    message.apply_subs = $Boolean(object.apply_subs);
                if (object.inherited != null)
                    message.inherited = $Boolean(object.inherited);
                if (object.user_id != null)
                    message.user_id = object.user_id >>> 0;
                if (object.group != null)
                    message.group = $String(object.group);
                if (object.grant != null)
                    message.grant = object.grant >>> 0;
                if (object.deny != null)
                    message.deny = object.deny >>> 0;
                return message;
            };

            ChanACL.toObject = function (message, options, _depth) {
                if (!options)
                    options = {};
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                let object = {};
                if (options.defaults) {
                    object.apply_here = true;
                    object.apply_subs = true;
                    object.inherited = true;
                    object.user_id = 0;
                    object.group = "";
                    object.grant = 0;
                    object.deny = 0;
                }
                if (message.apply_here != null && $Object.hasOwnProperty.call(message, "apply_here"))
                    object.apply_here = message.apply_here;
                if (message.apply_subs != null && $Object.hasOwnProperty.call(message, "apply_subs"))
                    object.apply_subs = message.apply_subs;
                if (message.inherited != null && $Object.hasOwnProperty.call(message, "inherited"))
                    object.inherited = message.inherited;
                if (message.user_id != null && $Object.hasOwnProperty.call(message, "user_id"))
                    object.user_id = message.user_id;
                if (message.group != null && $Object.hasOwnProperty.call(message, "group"))
                    object.group = message.group;
                if (message.grant != null && $Object.hasOwnProperty.call(message, "grant"))
                    object.grant = message.grant;
                if (message.deny != null && $Object.hasOwnProperty.call(message, "deny"))
                    object.deny = message.deny;
                return object;
            };

            ChanACL.prototype.toJSON = function() {
                return ChanACL.toObject(this, $protobuf.util.toJSONOptions);
            };

            ChanACL.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/MumbleProto.ACL.ChanACL";
            };

            return ChanACL;
        })();

        return ACL;
    })();

    MumbleProto.QueryUsers = (function() {

        const QueryUsers = function (properties) {
            this.ids = [];
            this.names = [];
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        QueryUsers.prototype.ids = $util.emptyArray;
        QueryUsers.prototype.names = $util.emptyArray;

        QueryUsers.create = function(properties) {
            return new QueryUsers(properties);
        };

        QueryUsers.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.ids != null && message.ids.length)
                for (let i = 0; i < message.ids.length; ++i)
                    writer.uint32(8).uint32(message.ids[i]);
            if (message.names != null && message.names.length)
                for (let i = 0; i < message.names.length; ++i)
                    writer.uint32(18).string(message.names[i]);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        QueryUsers.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end, message;
            if (length === $undefined)
                end = reader.len;
            else {
                end = reader.pos + length;
                if (end > reader.len)
                    throw $RangeError("index out of range");
                length = reader.len;
                reader.len = end;
            }
            message = _target || new $root.MumbleProto.QueryUsers();
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
                        if (wireType === 2) {
                            if (!(message.ids && message.ids.length))
                                message.ids = [];
                            reader.uint32s(message.ids);
                            continue;
                        }
                        if (wireType !== 0)
                            break;
                        if (!(message.ids && message.ids.length))
                            message.ids = [];
                        message.ids.push(reader.uint32());
                        continue;
                    }
                case 2: {
                        if (wireType !== 2)
                            break;
                        if (!(message.names && message.names.length))
                            message.names = [];
                        message.names.push(reader.string());
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

        QueryUsers.verify = function (message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (message.ids != null && $Object.hasOwnProperty.call(message, "ids")) {
                if (!$Array.isArray(message.ids))
                    return "ids: array expected";
                for (let i = 0; i < message.ids.length; ++i)
                    if (!$util.isInteger(message.ids[i]))
                        return "ids: integer[] expected";
            }
            if (message.names != null && $Object.hasOwnProperty.call(message, "names")) {
                if (!$Array.isArray(message.names))
                    return "names: array expected";
                for (let i = 0; i < message.names.length; ++i)
                    if (!$util.isString(message.names[i]))
                        return "names: string[] expected";
            }
            return null;
        };

        QueryUsers.fromObject = function (object, _depth) {
            if (object instanceof $root.MumbleProto.QueryUsers)
                return object;
            if (!$util.isObject(object))
                throw $TypeError(".MumbleProto.QueryUsers: object expected");
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let message = new $root.MumbleProto.QueryUsers();
            if (object.ids) {
                if (!$Array.isArray(object.ids))
                    throw $TypeError(".MumbleProto.QueryUsers.ids: array expected");
                message.ids = $Array(object.ids.length);
                for (let i = 0; i < object.ids.length; ++i)
                    message.ids[i] = object.ids[i] >>> 0;
            }
            if (object.names) {
                if (!$Array.isArray(object.names))
                    throw $TypeError(".MumbleProto.QueryUsers.names: array expected");
                message.names = $Array(object.names.length);
                for (let i = 0; i < object.names.length; ++i)
                    message.names[i] = $String(object.names[i]);
            }
            return message;
        };

        QueryUsers.toObject = function (message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let object = {};
            if (options.arrays || options.defaults) {
                object.ids = [];
                object.names = [];
            }
            if (message.ids && message.ids.length) {
                object.ids = $Array(message.ids.length);
                for (let j = 0; j < message.ids.length; ++j)
                    object.ids[j] = message.ids[j];
            }
            if (message.names && message.names.length) {
                object.names = $Array(message.names.length);
                for (let j = 0; j < message.names.length; ++j)
                    object.names[j] = message.names[j];
            }
            return object;
        };

        QueryUsers.prototype.toJSON = function() {
            return QueryUsers.toObject(this, $protobuf.util.toJSONOptions);
        };

        QueryUsers.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/MumbleProto.QueryUsers";
        };

        return QueryUsers;
    })();

    MumbleProto.CryptSetup = (function() {

        const CryptSetup = function (properties) {
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        CryptSetup.prototype.key = $util.newBuffer([]);
        CryptSetup.prototype.client_nonce = $util.newBuffer([]);
        CryptSetup.prototype.server_nonce = $util.newBuffer([]);

        CryptSetup.create = function(properties) {
            return new CryptSetup(properties);
        };

        CryptSetup.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.key != null && $Object.hasOwnProperty.call(message, "key"))
                writer.uint32(10).bytes(message.key);
            if (message.client_nonce != null && $Object.hasOwnProperty.call(message, "client_nonce"))
                writer.uint32(18).bytes(message.client_nonce);
            if (message.server_nonce != null && $Object.hasOwnProperty.call(message, "server_nonce"))
                writer.uint32(26).bytes(message.server_nonce);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        CryptSetup.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end, message;
            if (length === $undefined)
                end = reader.len;
            else {
                end = reader.pos + length;
                if (end > reader.len)
                    throw $RangeError("index out of range");
                length = reader.len;
                reader.len = end;
            }
            message = _target || new $root.MumbleProto.CryptSetup();
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
                        if (wireType !== 2)
                            break;
                        message.key = reader.bytes();
                        continue;
                    }
                case 2: {
                        if (wireType !== 2)
                            break;
                        message.client_nonce = reader.bytes();
                        continue;
                    }
                case 3: {
                        if (wireType !== 2)
                            break;
                        message.server_nonce = reader.bytes();
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

        CryptSetup.verify = function (message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (message.key != null && $Object.hasOwnProperty.call(message, "key"))
                if (!(message.key && typeof message.key.length === "number" || $util.isString(message.key)))
                    return "key: buffer expected";
            if (message.client_nonce != null && $Object.hasOwnProperty.call(message, "client_nonce"))
                if (!(message.client_nonce && typeof message.client_nonce.length === "number" || $util.isString(message.client_nonce)))
                    return "client_nonce: buffer expected";
            if (message.server_nonce != null && $Object.hasOwnProperty.call(message, "server_nonce"))
                if (!(message.server_nonce && typeof message.server_nonce.length === "number" || $util.isString(message.server_nonce)))
                    return "server_nonce: buffer expected";
            return null;
        };

        CryptSetup.fromObject = function (object, _depth) {
            if (object instanceof $root.MumbleProto.CryptSetup)
                return object;
            if (!$util.isObject(object))
                throw $TypeError(".MumbleProto.CryptSetup: object expected");
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let message = new $root.MumbleProto.CryptSetup();
            if (object.key != null)
                if (typeof object.key === "string")
                    $util.base64.decode(object.key, message.key = $util.newBuffer($util.base64.length(object.key)), 0);
                else if (object.key.length >= 0)
                    message.key = object.key;
            if (object.client_nonce != null)
                if (typeof object.client_nonce === "string")
                    $util.base64.decode(object.client_nonce, message.client_nonce = $util.newBuffer($util.base64.length(object.client_nonce)), 0);
                else if (object.client_nonce.length >= 0)
                    message.client_nonce = object.client_nonce;
            if (object.server_nonce != null)
                if (typeof object.server_nonce === "string")
                    $util.base64.decode(object.server_nonce, message.server_nonce = $util.newBuffer($util.base64.length(object.server_nonce)), 0);
                else if (object.server_nonce.length >= 0)
                    message.server_nonce = object.server_nonce;
            return message;
        };

        CryptSetup.toObject = function (message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let object = {};
            if (options.defaults) {
                if (options.bytes === $String)
                    object.key = "";
                else {
                    object.key = [];
                    if (options.bytes !== $Array)
                        object.key = $util.newBuffer(object.key);
                }
                if (options.bytes === $String)
                    object.client_nonce = "";
                else {
                    object.client_nonce = [];
                    if (options.bytes !== $Array)
                        object.client_nonce = $util.newBuffer(object.client_nonce);
                }
                if (options.bytes === $String)
                    object.server_nonce = "";
                else {
                    object.server_nonce = [];
                    if (options.bytes !== $Array)
                        object.server_nonce = $util.newBuffer(object.server_nonce);
                }
            }
            if (message.key != null && $Object.hasOwnProperty.call(message, "key"))
                object.key = options.bytes === $String ? $util.base64.encode(message.key, 0, message.key.length) : options.bytes === $Array ? $Array.prototype.slice.call(message.key) : message.key;
            if (message.client_nonce != null && $Object.hasOwnProperty.call(message, "client_nonce"))
                object.client_nonce = options.bytes === $String ? $util.base64.encode(message.client_nonce, 0, message.client_nonce.length) : options.bytes === $Array ? $Array.prototype.slice.call(message.client_nonce) : message.client_nonce;
            if (message.server_nonce != null && $Object.hasOwnProperty.call(message, "server_nonce"))
                object.server_nonce = options.bytes === $String ? $util.base64.encode(message.server_nonce, 0, message.server_nonce.length) : options.bytes === $Array ? $Array.prototype.slice.call(message.server_nonce) : message.server_nonce;
            return object;
        };

        CryptSetup.prototype.toJSON = function() {
            return CryptSetup.toObject(this, $protobuf.util.toJSONOptions);
        };

        CryptSetup.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/MumbleProto.CryptSetup";
        };

        return CryptSetup;
    })();

    MumbleProto.ContextActionModify = (function() {

        const ContextActionModify = function (properties) {
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        ContextActionModify.prototype.action = "";
        ContextActionModify.prototype.text = "";
        ContextActionModify.prototype.context = 0;
        ContextActionModify.prototype.operation = 0;

        ContextActionModify.create = function(properties) {
            return new ContextActionModify(properties);
        };

        ContextActionModify.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            writer.uint32(10).string(message.action);
            if (message.text != null && $Object.hasOwnProperty.call(message, "text"))
                writer.uint32(18).string(message.text);
            if (message.context != null && $Object.hasOwnProperty.call(message, "context"))
                writer.uint32(24).uint32(message.context);
            if (message.operation != null && $Object.hasOwnProperty.call(message, "operation"))
                writer.uint32(32).int32(message.operation);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        ContextActionModify.decode = function (reader, length, _end, _depth, _target) {
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
            message = _target || new $root.MumbleProto.ContextActionModify();
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
                        if (wireType !== 2)
                            break;
                        message.action = reader.string();
                        continue;
                    }
                case 2: {
                        if (wireType !== 2)
                            break;
                        message.text = reader.string();
                        continue;
                    }
                case 3: {
                        if (wireType !== 0)
                            break;
                        message.context = reader.uint32();
                        continue;
                    }
                case 4: {
                        if (wireType !== 0)
                            break;
                        value = reader.int32();
                        if ($root.MumbleProto.ContextActionModify.Operation[value] !== $undefined)
                            message.operation = value;
                        else if (!reader.discardUnknown) {
                            $util.makeProp(message, "$unknowns", false);
                            (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
                        }
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
            if (!$Object.hasOwnProperty.call(message, "action"))
                throw $util.ProtocolError("missing required 'action'", { instance: message });
            return message;
        };

        ContextActionModify.verify = function (message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (!$util.isString(message.action))
                return "action: string expected";
            if (message.text != null && $Object.hasOwnProperty.call(message, "text"))
                if (!$util.isString(message.text))
                    return "text: string expected";
            if (message.context != null && $Object.hasOwnProperty.call(message, "context"))
                if (!$util.isInteger(message.context))
                    return "context: integer expected";
            if (message.operation != null && $Object.hasOwnProperty.call(message, "operation"))
                switch (message.operation) {
                default:
                    return "operation: enum value expected";
                case 0:
                case 1:
                    break;
                }
            return null;
        };

        ContextActionModify.fromObject = function (object, _depth) {
            if (object instanceof $root.MumbleProto.ContextActionModify)
                return object;
            if (!$util.isObject(object))
                throw $TypeError(".MumbleProto.ContextActionModify: object expected");
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let message = new $root.MumbleProto.ContextActionModify();
            if (object.action != null)
                message.action = $String(object.action);
            if (object.text != null)
                message.text = $String(object.text);
            if (object.context != null)
                message.context = object.context >>> 0;
            switch (object.operation) {
            case "Add":
            case 0:
                message.operation = 0;
                break;
            case "Remove":
            case 1:
                message.operation = 1;
                break;
            default:
            }
            return message;
        };

        ContextActionModify.toObject = function (message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let object = {};
            if (options.defaults) {
                object.action = "";
                object.text = "";
                object.context = 0;
                object.operation = options.enums === $String ? "Add" : 0;
            }
            if (message.action != null && $Object.hasOwnProperty.call(message, "action"))
                object.action = message.action;
            if (message.text != null && $Object.hasOwnProperty.call(message, "text"))
                object.text = message.text;
            if (message.context != null && $Object.hasOwnProperty.call(message, "context"))
                object.context = message.context;
            if (message.operation != null && $Object.hasOwnProperty.call(message, "operation"))
                object.operation = options.enums === $String ? $root.MumbleProto.ContextActionModify.Operation[message.operation] === $undefined ? message.operation : $root.MumbleProto.ContextActionModify.Operation[message.operation] : message.operation;
            return object;
        };

        ContextActionModify.prototype.toJSON = function() {
            return ContextActionModify.toObject(this, $protobuf.util.toJSONOptions);
        };

        ContextActionModify.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/MumbleProto.ContextActionModify";
        };

        ContextActionModify.Context = (function() {
            const valuesById = $Object.create(null), values = $Object.create(valuesById);
            values[valuesById[1] = "Server"] = 1;
            values[valuesById[2] = "Channel"] = 2;
            values[valuesById[4] = "User"] = 4;
            return values;
        })();

        ContextActionModify.Operation = (function() {
            const valuesById = $Object.create(null), values = $Object.create(valuesById);
            values[valuesById[0] = "Add"] = 0;
            values[valuesById[1] = "Remove"] = 1;
            return values;
        })();

        return ContextActionModify;
    })();

    MumbleProto.ContextAction = (function() {

        const ContextAction = function (properties) {
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        ContextAction.prototype.session = 0;
        ContextAction.prototype.channel_id = 0;
        ContextAction.prototype.action = "";

        ContextAction.create = function(properties) {
            return new ContextAction(properties);
        };

        ContextAction.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.session != null && $Object.hasOwnProperty.call(message, "session"))
                writer.uint32(8).uint32(message.session);
            if (message.channel_id != null && $Object.hasOwnProperty.call(message, "channel_id"))
                writer.uint32(16).uint32(message.channel_id);
            writer.uint32(26).string(message.action);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        ContextAction.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end, message;
            if (length === $undefined)
                end = reader.len;
            else {
                end = reader.pos + length;
                if (end > reader.len)
                    throw $RangeError("index out of range");
                length = reader.len;
                reader.len = end;
            }
            message = _target || new $root.MumbleProto.ContextAction();
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
                        message.session = reader.uint32();
                        continue;
                    }
                case 2: {
                        if (wireType !== 0)
                            break;
                        message.channel_id = reader.uint32();
                        continue;
                    }
                case 3: {
                        if (wireType !== 2)
                            break;
                        message.action = reader.string();
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
            if (!$Object.hasOwnProperty.call(message, "action"))
                throw $util.ProtocolError("missing required 'action'", { instance: message });
            return message;
        };

        ContextAction.verify = function (message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (message.session != null && $Object.hasOwnProperty.call(message, "session"))
                if (!$util.isInteger(message.session))
                    return "session: integer expected";
            if (message.channel_id != null && $Object.hasOwnProperty.call(message, "channel_id"))
                if (!$util.isInteger(message.channel_id))
                    return "channel_id: integer expected";
            if (!$util.isString(message.action))
                return "action: string expected";
            return null;
        };

        ContextAction.fromObject = function (object, _depth) {
            if (object instanceof $root.MumbleProto.ContextAction)
                return object;
            if (!$util.isObject(object))
                throw $TypeError(".MumbleProto.ContextAction: object expected");
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let message = new $root.MumbleProto.ContextAction();
            if (object.session != null)
                message.session = object.session >>> 0;
            if (object.channel_id != null)
                message.channel_id = object.channel_id >>> 0;
            if (object.action != null)
                message.action = $String(object.action);
            return message;
        };

        ContextAction.toObject = function (message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let object = {};
            if (options.defaults) {
                object.session = 0;
                object.channel_id = 0;
                object.action = "";
            }
            if (message.session != null && $Object.hasOwnProperty.call(message, "session"))
                object.session = message.session;
            if (message.channel_id != null && $Object.hasOwnProperty.call(message, "channel_id"))
                object.channel_id = message.channel_id;
            if (message.action != null && $Object.hasOwnProperty.call(message, "action"))
                object.action = message.action;
            return object;
        };

        ContextAction.prototype.toJSON = function() {
            return ContextAction.toObject(this, $protobuf.util.toJSONOptions);
        };

        ContextAction.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/MumbleProto.ContextAction";
        };

        return ContextAction;
    })();

    MumbleProto.UserList = (function() {

        const UserList = function (properties) {
            this.users = [];
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        UserList.prototype.users = $util.emptyArray;

        UserList.create = function(properties) {
            return new UserList(properties);
        };

        UserList.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.users != null && message.users.length)
                for (let i = 0; i < message.users.length; ++i)
                    $root.MumbleProto.UserList.User.encode(message.users[i], writer.uint32(10).fork(), _depth + 1).ldelim();
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        UserList.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end, message;
            if (length === $undefined)
                end = reader.len;
            else {
                end = reader.pos + length;
                if (end > reader.len)
                    throw $RangeError("index out of range");
                length = reader.len;
                reader.len = end;
            }
            message = _target || new $root.MumbleProto.UserList();
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
                        if (wireType !== 2)
                            break;
                        if (!(message.users && message.users.length))
                            message.users = [];
                        message.users.push($root.MumbleProto.UserList.User.decode(reader, reader.uint32(), $undefined, _depth + 1));
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

        UserList.verify = function (message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (message.users != null && $Object.hasOwnProperty.call(message, "users")) {
                if (!$Array.isArray(message.users))
                    return "users: array expected";
                for (let i = 0; i < message.users.length; ++i) {
                    let error = $root.MumbleProto.UserList.User.verify(message.users[i], _depth + 1);
                    if (error)
                        return "users." + error;
                }
            }
            return null;
        };

        UserList.fromObject = function (object, _depth) {
            if (object instanceof $root.MumbleProto.UserList)
                return object;
            if (!$util.isObject(object))
                throw $TypeError(".MumbleProto.UserList: object expected");
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let message = new $root.MumbleProto.UserList();
            if (object.users) {
                if (!$Array.isArray(object.users))
                    throw $TypeError(".MumbleProto.UserList.users: array expected");
                message.users = $Array(object.users.length);
                for (let i = 0; i < object.users.length; ++i) {
                    if (!$util.isObject(object.users[i]))
                        throw $TypeError(".MumbleProto.UserList.users: object expected");
                    message.users[i] = $root.MumbleProto.UserList.User.fromObject(object.users[i], _depth + 1);
                }
            }
            return message;
        };

        UserList.toObject = function (message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let object = {};
            if (options.arrays || options.defaults)
                object.users = [];
            if (message.users && message.users.length) {
                object.users = $Array(message.users.length);
                for (let j = 0; j < message.users.length; ++j)
                    object.users[j] = $root.MumbleProto.UserList.User.toObject(message.users[j], options, _depth + 1);
            }
            return object;
        };

        UserList.prototype.toJSON = function() {
            return UserList.toObject(this, $protobuf.util.toJSONOptions);
        };

        UserList.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/MumbleProto.UserList";
        };

        UserList.User = (function() {

            const User = function (properties) {
                if (properties)
                    for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null && keys[i] !== "__proto__")
                            this[keys[i]] = properties[keys[i]];
            };

            User.prototype.user_id = 0;
            User.prototype.name = "";
            User.prototype.last_seen = "";
            User.prototype.last_channel = 0;

            User.create = function(properties) {
                return new User(properties);
            };

            User.encode = function (message, writer, _depth) {
                if (!writer)
                    writer = $Writer.create();
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                writer.uint32(8).uint32(message.user_id);
                if (message.name != null && $Object.hasOwnProperty.call(message, "name"))
                    writer.uint32(18).string(message.name);
                if (message.last_seen != null && $Object.hasOwnProperty.call(message, "last_seen"))
                    writer.uint32(26).string(message.last_seen);
                if (message.last_channel != null && $Object.hasOwnProperty.call(message, "last_channel"))
                    writer.uint32(32).uint32(message.last_channel);
                if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                    for (let i = 0; i < message.$unknowns.length; ++i)
                        writer.raw(message.$unknowns[i]);
                return writer;
            };

            User.decode = function (reader, length, _end, _depth, _target) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                let end, message;
                if (length === $undefined)
                    end = reader.len;
                else {
                    end = reader.pos + length;
                    if (end > reader.len)
                        throw $RangeError("index out of range");
                    length = reader.len;
                    reader.len = end;
                }
                message = _target || new $root.MumbleProto.UserList.User();
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
                            message.user_id = reader.uint32();
                            continue;
                        }
                    case 2: {
                            if (wireType !== 2)
                                break;
                            message.name = reader.string();
                            continue;
                        }
                    case 3: {
                            if (wireType !== 2)
                                break;
                            message.last_seen = reader.string();
                            continue;
                        }
                    case 4: {
                            if (wireType !== 0)
                                break;
                            message.last_channel = reader.uint32();
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
                if (!$Object.hasOwnProperty.call(message, "user_id"))
                    throw $util.ProtocolError("missing required 'user_id'", { instance: message });
                return message;
            };

            User.verify = function (message, _depth) {
                if (typeof message !== "object" || message === null)
                    return "object expected";
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    return "max depth exceeded";
                if (!$util.isInteger(message.user_id))
                    return "user_id: integer expected";
                if (message.name != null && $Object.hasOwnProperty.call(message, "name"))
                    if (!$util.isString(message.name))
                        return "name: string expected";
                if (message.last_seen != null && $Object.hasOwnProperty.call(message, "last_seen"))
                    if (!$util.isString(message.last_seen))
                        return "last_seen: string expected";
                if (message.last_channel != null && $Object.hasOwnProperty.call(message, "last_channel"))
                    if (!$util.isInteger(message.last_channel))
                        return "last_channel: integer expected";
                return null;
            };

            User.fromObject = function (object, _depth) {
                if (object instanceof $root.MumbleProto.UserList.User)
                    return object;
                if (!$util.isObject(object))
                    throw $TypeError(".MumbleProto.UserList.User: object expected");
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                let message = new $root.MumbleProto.UserList.User();
                if (object.user_id != null)
                    message.user_id = object.user_id >>> 0;
                if (object.name != null)
                    message.name = $String(object.name);
                if (object.last_seen != null)
                    message.last_seen = $String(object.last_seen);
                if (object.last_channel != null)
                    message.last_channel = object.last_channel >>> 0;
                return message;
            };

            User.toObject = function (message, options, _depth) {
                if (!options)
                    options = {};
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                let object = {};
                if (options.defaults) {
                    object.user_id = 0;
                    object.name = "";
                    object.last_seen = "";
                    object.last_channel = 0;
                }
                if (message.user_id != null && $Object.hasOwnProperty.call(message, "user_id"))
                    object.user_id = message.user_id;
                if (message.name != null && $Object.hasOwnProperty.call(message, "name"))
                    object.name = message.name;
                if (message.last_seen != null && $Object.hasOwnProperty.call(message, "last_seen"))
                    object.last_seen = message.last_seen;
                if (message.last_channel != null && $Object.hasOwnProperty.call(message, "last_channel"))
                    object.last_channel = message.last_channel;
                return object;
            };

            User.prototype.toJSON = function() {
                return User.toObject(this, $protobuf.util.toJSONOptions);
            };

            User.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/MumbleProto.UserList.User";
            };

            return User;
        })();

        return UserList;
    })();

    MumbleProto.VoiceTarget = (function() {

        const VoiceTarget = function (properties) {
            this.targets = [];
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        VoiceTarget.prototype.id = 0;
        VoiceTarget.prototype.targets = $util.emptyArray;

        VoiceTarget.create = function(properties) {
            return new VoiceTarget(properties);
        };

        VoiceTarget.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.id != null && $Object.hasOwnProperty.call(message, "id"))
                writer.uint32(8).uint32(message.id);
            if (message.targets != null && message.targets.length)
                for (let i = 0; i < message.targets.length; ++i)
                    $root.MumbleProto.VoiceTarget.Target.encode(message.targets[i], writer.uint32(18).fork(), _depth + 1).ldelim();
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        VoiceTarget.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end, message;
            if (length === $undefined)
                end = reader.len;
            else {
                end = reader.pos + length;
                if (end > reader.len)
                    throw $RangeError("index out of range");
                length = reader.len;
                reader.len = end;
            }
            message = _target || new $root.MumbleProto.VoiceTarget();
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
                        message.id = reader.uint32();
                        continue;
                    }
                case 2: {
                        if (wireType !== 2)
                            break;
                        if (!(message.targets && message.targets.length))
                            message.targets = [];
                        message.targets.push($root.MumbleProto.VoiceTarget.Target.decode(reader, reader.uint32(), $undefined, _depth + 1));
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

        VoiceTarget.verify = function (message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (message.id != null && $Object.hasOwnProperty.call(message, "id"))
                if (!$util.isInteger(message.id))
                    return "id: integer expected";
            if (message.targets != null && $Object.hasOwnProperty.call(message, "targets")) {
                if (!$Array.isArray(message.targets))
                    return "targets: array expected";
                for (let i = 0; i < message.targets.length; ++i) {
                    let error = $root.MumbleProto.VoiceTarget.Target.verify(message.targets[i], _depth + 1);
                    if (error)
                        return "targets." + error;
                }
            }
            return null;
        };

        VoiceTarget.fromObject = function (object, _depth) {
            if (object instanceof $root.MumbleProto.VoiceTarget)
                return object;
            if (!$util.isObject(object))
                throw $TypeError(".MumbleProto.VoiceTarget: object expected");
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let message = new $root.MumbleProto.VoiceTarget();
            if (object.id != null)
                message.id = object.id >>> 0;
            if (object.targets) {
                if (!$Array.isArray(object.targets))
                    throw $TypeError(".MumbleProto.VoiceTarget.targets: array expected");
                message.targets = $Array(object.targets.length);
                for (let i = 0; i < object.targets.length; ++i) {
                    if (!$util.isObject(object.targets[i]))
                        throw $TypeError(".MumbleProto.VoiceTarget.targets: object expected");
                    message.targets[i] = $root.MumbleProto.VoiceTarget.Target.fromObject(object.targets[i], _depth + 1);
                }
            }
            return message;
        };

        VoiceTarget.toObject = function (message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let object = {};
            if (options.arrays || options.defaults)
                object.targets = [];
            if (options.defaults)
                object.id = 0;
            if (message.id != null && $Object.hasOwnProperty.call(message, "id"))
                object.id = message.id;
            if (message.targets && message.targets.length) {
                object.targets = $Array(message.targets.length);
                for (let j = 0; j < message.targets.length; ++j)
                    object.targets[j] = $root.MumbleProto.VoiceTarget.Target.toObject(message.targets[j], options, _depth + 1);
            }
            return object;
        };

        VoiceTarget.prototype.toJSON = function() {
            return VoiceTarget.toObject(this, $protobuf.util.toJSONOptions);
        };

        VoiceTarget.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/MumbleProto.VoiceTarget";
        };

        VoiceTarget.Target = (function() {

            const Target = function (properties) {
                this.session = [];
                if (properties)
                    for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null && keys[i] !== "__proto__")
                            this[keys[i]] = properties[keys[i]];
            };

            Target.prototype.session = $util.emptyArray;
            Target.prototype.channel_id = 0;
            Target.prototype.group = "";
            Target.prototype.links = false;
            Target.prototype.children = false;

            Target.create = function(properties) {
                return new Target(properties);
            };

            Target.encode = function (message, writer, _depth) {
                if (!writer)
                    writer = $Writer.create();
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (message.session != null && message.session.length)
                    for (let i = 0; i < message.session.length; ++i)
                        writer.uint32(8).uint32(message.session[i]);
                if (message.channel_id != null && $Object.hasOwnProperty.call(message, "channel_id"))
                    writer.uint32(16).uint32(message.channel_id);
                if (message.group != null && $Object.hasOwnProperty.call(message, "group"))
                    writer.uint32(26).string(message.group);
                if (message.links != null && $Object.hasOwnProperty.call(message, "links"))
                    writer.uint32(32).bool(message.links);
                if (message.children != null && $Object.hasOwnProperty.call(message, "children"))
                    writer.uint32(40).bool(message.children);
                if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                    for (let i = 0; i < message.$unknowns.length; ++i)
                        writer.raw(message.$unknowns[i]);
                return writer;
            };

            Target.decode = function (reader, length, _end, _depth, _target) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                let end, message;
                if (length === $undefined)
                    end = reader.len;
                else {
                    end = reader.pos + length;
                    if (end > reader.len)
                        throw $RangeError("index out of range");
                    length = reader.len;
                    reader.len = end;
                }
                message = _target || new $root.MumbleProto.VoiceTarget.Target();
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
                            if (wireType === 2) {
                                if (!(message.session && message.session.length))
                                    message.session = [];
                                reader.uint32s(message.session);
                                continue;
                            }
                            if (wireType !== 0)
                                break;
                            if (!(message.session && message.session.length))
                                message.session = [];
                            message.session.push(reader.uint32());
                            continue;
                        }
                    case 2: {
                            if (wireType !== 0)
                                break;
                            message.channel_id = reader.uint32();
                            continue;
                        }
                    case 3: {
                            if (wireType !== 2)
                                break;
                            message.group = reader.string();
                            continue;
                        }
                    case 4: {
                            if (wireType !== 0)
                                break;
                            message.links = reader.bool();
                            continue;
                        }
                    case 5: {
                            if (wireType !== 0)
                                break;
                            message.children = reader.bool();
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

            Target.verify = function (message, _depth) {
                if (typeof message !== "object" || message === null)
                    return "object expected";
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    return "max depth exceeded";
                if (message.session != null && $Object.hasOwnProperty.call(message, "session")) {
                    if (!$Array.isArray(message.session))
                        return "session: array expected";
                    for (let i = 0; i < message.session.length; ++i)
                        if (!$util.isInteger(message.session[i]))
                            return "session: integer[] expected";
                }
                if (message.channel_id != null && $Object.hasOwnProperty.call(message, "channel_id"))
                    if (!$util.isInteger(message.channel_id))
                        return "channel_id: integer expected";
                if (message.group != null && $Object.hasOwnProperty.call(message, "group"))
                    if (!$util.isString(message.group))
                        return "group: string expected";
                if (message.links != null && $Object.hasOwnProperty.call(message, "links"))
                    if (typeof message.links !== "boolean")
                        return "links: boolean expected";
                if (message.children != null && $Object.hasOwnProperty.call(message, "children"))
                    if (typeof message.children !== "boolean")
                        return "children: boolean expected";
                return null;
            };

            Target.fromObject = function (object, _depth) {
                if (object instanceof $root.MumbleProto.VoiceTarget.Target)
                    return object;
                if (!$util.isObject(object))
                    throw $TypeError(".MumbleProto.VoiceTarget.Target: object expected");
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                let message = new $root.MumbleProto.VoiceTarget.Target();
                if (object.session) {
                    if (!$Array.isArray(object.session))
                        throw $TypeError(".MumbleProto.VoiceTarget.Target.session: array expected");
                    message.session = $Array(object.session.length);
                    for (let i = 0; i < object.session.length; ++i)
                        message.session[i] = object.session[i] >>> 0;
                }
                if (object.channel_id != null)
                    message.channel_id = object.channel_id >>> 0;
                if (object.group != null)
                    message.group = $String(object.group);
                if (object.links != null)
                    message.links = $Boolean(object.links);
                if (object.children != null)
                    message.children = $Boolean(object.children);
                return message;
            };

            Target.toObject = function (message, options, _depth) {
                if (!options)
                    options = {};
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                let object = {};
                if (options.arrays || options.defaults)
                    object.session = [];
                if (options.defaults) {
                    object.channel_id = 0;
                    object.group = "";
                    object.links = false;
                    object.children = false;
                }
                if (message.session && message.session.length) {
                    object.session = $Array(message.session.length);
                    for (let j = 0; j < message.session.length; ++j)
                        object.session[j] = message.session[j];
                }
                if (message.channel_id != null && $Object.hasOwnProperty.call(message, "channel_id"))
                    object.channel_id = message.channel_id;
                if (message.group != null && $Object.hasOwnProperty.call(message, "group"))
                    object.group = message.group;
                if (message.links != null && $Object.hasOwnProperty.call(message, "links"))
                    object.links = message.links;
                if (message.children != null && $Object.hasOwnProperty.call(message, "children"))
                    object.children = message.children;
                return object;
            };

            Target.prototype.toJSON = function() {
                return Target.toObject(this, $protobuf.util.toJSONOptions);
            };

            Target.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/MumbleProto.VoiceTarget.Target";
            };

            return Target;
        })();

        return VoiceTarget;
    })();

    MumbleProto.PermissionQuery = (function() {

        const PermissionQuery = function (properties) {
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        PermissionQuery.prototype.channel_id = 0;
        PermissionQuery.prototype.permissions = 0;
        PermissionQuery.prototype.flush = false;

        PermissionQuery.create = function(properties) {
            return new PermissionQuery(properties);
        };

        PermissionQuery.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.channel_id != null && $Object.hasOwnProperty.call(message, "channel_id"))
                writer.uint32(8).uint32(message.channel_id);
            if (message.permissions != null && $Object.hasOwnProperty.call(message, "permissions"))
                writer.uint32(16).uint32(message.permissions);
            if (message.flush != null && $Object.hasOwnProperty.call(message, "flush"))
                writer.uint32(24).bool(message.flush);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        PermissionQuery.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end, message;
            if (length === $undefined)
                end = reader.len;
            else {
                end = reader.pos + length;
                if (end > reader.len)
                    throw $RangeError("index out of range");
                length = reader.len;
                reader.len = end;
            }
            message = _target || new $root.MumbleProto.PermissionQuery();
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
                        message.channel_id = reader.uint32();
                        continue;
                    }
                case 2: {
                        if (wireType !== 0)
                            break;
                        message.permissions = reader.uint32();
                        continue;
                    }
                case 3: {
                        if (wireType !== 0)
                            break;
                        message.flush = reader.bool();
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

        PermissionQuery.verify = function (message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (message.channel_id != null && $Object.hasOwnProperty.call(message, "channel_id"))
                if (!$util.isInteger(message.channel_id))
                    return "channel_id: integer expected";
            if (message.permissions != null && $Object.hasOwnProperty.call(message, "permissions"))
                if (!$util.isInteger(message.permissions))
                    return "permissions: integer expected";
            if (message.flush != null && $Object.hasOwnProperty.call(message, "flush"))
                if (typeof message.flush !== "boolean")
                    return "flush: boolean expected";
            return null;
        };

        PermissionQuery.fromObject = function (object, _depth) {
            if (object instanceof $root.MumbleProto.PermissionQuery)
                return object;
            if (!$util.isObject(object))
                throw $TypeError(".MumbleProto.PermissionQuery: object expected");
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let message = new $root.MumbleProto.PermissionQuery();
            if (object.channel_id != null)
                message.channel_id = object.channel_id >>> 0;
            if (object.permissions != null)
                message.permissions = object.permissions >>> 0;
            if (object.flush != null)
                message.flush = $Boolean(object.flush);
            return message;
        };

        PermissionQuery.toObject = function (message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let object = {};
            if (options.defaults) {
                object.channel_id = 0;
                object.permissions = 0;
                object.flush = false;
            }
            if (message.channel_id != null && $Object.hasOwnProperty.call(message, "channel_id"))
                object.channel_id = message.channel_id;
            if (message.permissions != null && $Object.hasOwnProperty.call(message, "permissions"))
                object.permissions = message.permissions;
            if (message.flush != null && $Object.hasOwnProperty.call(message, "flush"))
                object.flush = message.flush;
            return object;
        };

        PermissionQuery.prototype.toJSON = function() {
            return PermissionQuery.toObject(this, $protobuf.util.toJSONOptions);
        };

        PermissionQuery.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/MumbleProto.PermissionQuery";
        };

        return PermissionQuery;
    })();

    MumbleProto.CodecVersion = (function() {

        const CodecVersion = function (properties) {
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        CodecVersion.prototype.alpha = 0;
        CodecVersion.prototype.beta = 0;
        CodecVersion.prototype.prefer_alpha = true;
        CodecVersion.prototype.opus = false;

        CodecVersion.create = function(properties) {
            return new CodecVersion(properties);
        };

        CodecVersion.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            writer.uint32(8).int32(message.alpha);
            writer.uint32(16).int32(message.beta);
            writer.uint32(24).bool(message.prefer_alpha);
            if (message.opus != null && $Object.hasOwnProperty.call(message, "opus"))
                writer.uint32(32).bool(message.opus);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        CodecVersion.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end, message;
            if (length === $undefined)
                end = reader.len;
            else {
                end = reader.pos + length;
                if (end > reader.len)
                    throw $RangeError("index out of range");
                length = reader.len;
                reader.len = end;
            }
            message = _target || new $root.MumbleProto.CodecVersion();
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
                        message.alpha = reader.int32();
                        continue;
                    }
                case 2: {
                        if (wireType !== 0)
                            break;
                        message.beta = reader.int32();
                        continue;
                    }
                case 3: {
                        if (wireType !== 0)
                            break;
                        message.prefer_alpha = reader.bool();
                        continue;
                    }
                case 4: {
                        if (wireType !== 0)
                            break;
                        message.opus = reader.bool();
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
            if (!$Object.hasOwnProperty.call(message, "alpha"))
                throw $util.ProtocolError("missing required 'alpha'", { instance: message });
            if (!$Object.hasOwnProperty.call(message, "beta"))
                throw $util.ProtocolError("missing required 'beta'", { instance: message });
            if (!$Object.hasOwnProperty.call(message, "prefer_alpha"))
                throw $util.ProtocolError("missing required 'prefer_alpha'", { instance: message });
            return message;
        };

        CodecVersion.verify = function (message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (!$util.isInteger(message.alpha))
                return "alpha: integer expected";
            if (!$util.isInteger(message.beta))
                return "beta: integer expected";
            if (typeof message.prefer_alpha !== "boolean")
                return "prefer_alpha: boolean expected";
            if (message.opus != null && $Object.hasOwnProperty.call(message, "opus"))
                if (typeof message.opus !== "boolean")
                    return "opus: boolean expected";
            return null;
        };

        CodecVersion.fromObject = function (object, _depth) {
            if (object instanceof $root.MumbleProto.CodecVersion)
                return object;
            if (!$util.isObject(object))
                throw $TypeError(".MumbleProto.CodecVersion: object expected");
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let message = new $root.MumbleProto.CodecVersion();
            if (object.alpha != null)
                message.alpha = object.alpha | 0;
            if (object.beta != null)
                message.beta = object.beta | 0;
            if (object.prefer_alpha != null)
                message.prefer_alpha = $Boolean(object.prefer_alpha);
            if (object.opus != null)
                message.opus = $Boolean(object.opus);
            return message;
        };

        CodecVersion.toObject = function (message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let object = {};
            if (options.defaults) {
                object.alpha = 0;
                object.beta = 0;
                object.prefer_alpha = true;
                object.opus = false;
            }
            if (message.alpha != null && $Object.hasOwnProperty.call(message, "alpha"))
                object.alpha = message.alpha;
            if (message.beta != null && $Object.hasOwnProperty.call(message, "beta"))
                object.beta = message.beta;
            if (message.prefer_alpha != null && $Object.hasOwnProperty.call(message, "prefer_alpha"))
                object.prefer_alpha = message.prefer_alpha;
            if (message.opus != null && $Object.hasOwnProperty.call(message, "opus"))
                object.opus = message.opus;
            return object;
        };

        CodecVersion.prototype.toJSON = function() {
            return CodecVersion.toObject(this, $protobuf.util.toJSONOptions);
        };

        CodecVersion.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/MumbleProto.CodecVersion";
        };

        return CodecVersion;
    })();

    MumbleProto.UserStats = (function() {

        const UserStats = function (properties) {
            this.certificates = [];
            this.celt_versions = [];
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        UserStats.prototype.session = 0;
        UserStats.prototype.stats_only = false;
        UserStats.prototype.certificates = $util.emptyArray;
        UserStats.prototype.from_client = null;
        UserStats.prototype.from_server = null;
        UserStats.prototype.udp_packets = 0;
        UserStats.prototype.tcp_packets = 0;
        UserStats.prototype.udp_ping_avg = 0;
        UserStats.prototype.udp_ping_var = 0;
        UserStats.prototype.tcp_ping_avg = 0;
        UserStats.prototype.tcp_ping_var = 0;
        UserStats.prototype.version = null;
        UserStats.prototype.celt_versions = $util.emptyArray;
        UserStats.prototype.address = $util.newBuffer([]);
        UserStats.prototype.bandwidth = 0;
        UserStats.prototype.onlinesecs = 0;
        UserStats.prototype.idlesecs = 0;
        UserStats.prototype.strong_certificate = false;
        UserStats.prototype.opus = false;
        UserStats.prototype.rolling_stats = null;

        UserStats.create = function(properties) {
            return new UserStats(properties);
        };

        UserStats.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.session != null && $Object.hasOwnProperty.call(message, "session"))
                writer.uint32(8).uint32(message.session);
            if (message.stats_only != null && $Object.hasOwnProperty.call(message, "stats_only"))
                writer.uint32(16).bool(message.stats_only);
            if (message.certificates != null && message.certificates.length)
                for (let i = 0; i < message.certificates.length; ++i)
                    writer.uint32(26).bytes(message.certificates[i]);
            if (message.from_client != null && $Object.hasOwnProperty.call(message, "from_client"))
                $root.MumbleProto.UserStats.Stats.encode(message.from_client, writer.uint32(34).fork(), _depth + 1).ldelim();
            if (message.from_server != null && $Object.hasOwnProperty.call(message, "from_server"))
                $root.MumbleProto.UserStats.Stats.encode(message.from_server, writer.uint32(42).fork(), _depth + 1).ldelim();
            if (message.udp_packets != null && $Object.hasOwnProperty.call(message, "udp_packets"))
                writer.uint32(48).uint32(message.udp_packets);
            if (message.tcp_packets != null && $Object.hasOwnProperty.call(message, "tcp_packets"))
                writer.uint32(56).uint32(message.tcp_packets);
            if (message.udp_ping_avg != null && $Object.hasOwnProperty.call(message, "udp_ping_avg"))
                writer.uint32(69).float(message.udp_ping_avg);
            if (message.udp_ping_var != null && $Object.hasOwnProperty.call(message, "udp_ping_var"))
                writer.uint32(77).float(message.udp_ping_var);
            if (message.tcp_ping_avg != null && $Object.hasOwnProperty.call(message, "tcp_ping_avg"))
                writer.uint32(85).float(message.tcp_ping_avg);
            if (message.tcp_ping_var != null && $Object.hasOwnProperty.call(message, "tcp_ping_var"))
                writer.uint32(93).float(message.tcp_ping_var);
            if (message.version != null && $Object.hasOwnProperty.call(message, "version"))
                $root.MumbleProto.Version.encode(message.version, writer.uint32(98).fork(), _depth + 1).ldelim();
            if (message.celt_versions != null && message.celt_versions.length)
                for (let i = 0; i < message.celt_versions.length; ++i)
                    writer.uint32(104).int32(message.celt_versions[i]);
            if (message.address != null && $Object.hasOwnProperty.call(message, "address"))
                writer.uint32(114).bytes(message.address);
            if (message.bandwidth != null && $Object.hasOwnProperty.call(message, "bandwidth"))
                writer.uint32(120).uint32(message.bandwidth);
            if (message.onlinesecs != null && $Object.hasOwnProperty.call(message, "onlinesecs"))
                writer.uint32(128).uint32(message.onlinesecs);
            if (message.idlesecs != null && $Object.hasOwnProperty.call(message, "idlesecs"))
                writer.uint32(136).uint32(message.idlesecs);
            if (message.strong_certificate != null && $Object.hasOwnProperty.call(message, "strong_certificate"))
                writer.uint32(144).bool(message.strong_certificate);
            if (message.opus != null && $Object.hasOwnProperty.call(message, "opus"))
                writer.uint32(152).bool(message.opus);
            if (message.rolling_stats != null && $Object.hasOwnProperty.call(message, "rolling_stats"))
                $root.MumbleProto.UserStats.RollingStats.encode(message.rolling_stats, writer.uint32(162).fork(), _depth + 1).ldelim();
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        UserStats.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end, message;
            if (length === $undefined)
                end = reader.len;
            else {
                end = reader.pos + length;
                if (end > reader.len)
                    throw $RangeError("index out of range");
                length = reader.len;
                reader.len = end;
            }
            message = _target || new $root.MumbleProto.UserStats();
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
                        message.session = reader.uint32();
                        continue;
                    }
                case 2: {
                        if (wireType !== 0)
                            break;
                        message.stats_only = reader.bool();
                        continue;
                    }
                case 3: {
                        if (wireType !== 2)
                            break;
                        if (!(message.certificates && message.certificates.length))
                            message.certificates = [];
                        message.certificates.push(reader.bytes());
                        continue;
                    }
                case 4: {
                        if (wireType !== 2)
                            break;
                        message.from_client = $root.MumbleProto.UserStats.Stats.decode(reader, reader.uint32(), $undefined, _depth + 1, message.from_client);
                        continue;
                    }
                case 5: {
                        if (wireType !== 2)
                            break;
                        message.from_server = $root.MumbleProto.UserStats.Stats.decode(reader, reader.uint32(), $undefined, _depth + 1, message.from_server);
                        continue;
                    }
                case 6: {
                        if (wireType !== 0)
                            break;
                        message.udp_packets = reader.uint32();
                        continue;
                    }
                case 7: {
                        if (wireType !== 0)
                            break;
                        message.tcp_packets = reader.uint32();
                        continue;
                    }
                case 8: {
                        if (wireType !== 5)
                            break;
                        message.udp_ping_avg = reader.float();
                        continue;
                    }
                case 9: {
                        if (wireType !== 5)
                            break;
                        message.udp_ping_var = reader.float();
                        continue;
                    }
                case 10: {
                        if (wireType !== 5)
                            break;
                        message.tcp_ping_avg = reader.float();
                        continue;
                    }
                case 11: {
                        if (wireType !== 5)
                            break;
                        message.tcp_ping_var = reader.float();
                        continue;
                    }
                case 12: {
                        if (wireType !== 2)
                            break;
                        message.version = $root.MumbleProto.Version.decode(reader, reader.uint32(), $undefined, _depth + 1, message.version);
                        continue;
                    }
                case 13: {
                        if (wireType === 2) {
                            if (!(message.celt_versions && message.celt_versions.length))
                                message.celt_versions = [];
                            reader.int32s(message.celt_versions);
                            continue;
                        }
                        if (wireType !== 0)
                            break;
                        if (!(message.celt_versions && message.celt_versions.length))
                            message.celt_versions = [];
                        message.celt_versions.push(reader.int32());
                        continue;
                    }
                case 14: {
                        if (wireType !== 2)
                            break;
                        message.address = reader.bytes();
                        continue;
                    }
                case 15: {
                        if (wireType !== 0)
                            break;
                        message.bandwidth = reader.uint32();
                        continue;
                    }
                case 16: {
                        if (wireType !== 0)
                            break;
                        message.onlinesecs = reader.uint32();
                        continue;
                    }
                case 17: {
                        if (wireType !== 0)
                            break;
                        message.idlesecs = reader.uint32();
                        continue;
                    }
                case 18: {
                        if (wireType !== 0)
                            break;
                        message.strong_certificate = reader.bool();
                        continue;
                    }
                case 19: {
                        if (wireType !== 0)
                            break;
                        message.opus = reader.bool();
                        continue;
                    }
                case 20: {
                        if (wireType !== 2)
                            break;
                        message.rolling_stats = $root.MumbleProto.UserStats.RollingStats.decode(reader, reader.uint32(), $undefined, _depth + 1, message.rolling_stats);
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

        UserStats.verify = function (message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (message.session != null && $Object.hasOwnProperty.call(message, "session"))
                if (!$util.isInteger(message.session))
                    return "session: integer expected";
            if (message.stats_only != null && $Object.hasOwnProperty.call(message, "stats_only"))
                if (typeof message.stats_only !== "boolean")
                    return "stats_only: boolean expected";
            if (message.certificates != null && $Object.hasOwnProperty.call(message, "certificates")) {
                if (!$Array.isArray(message.certificates))
                    return "certificates: array expected";
                for (let i = 0; i < message.certificates.length; ++i)
                    if (!(message.certificates[i] && typeof message.certificates[i].length === "number" || $util.isString(message.certificates[i])))
                        return "certificates: buffer[] expected";
            }
            if (message.from_client != null && $Object.hasOwnProperty.call(message, "from_client")) {
                let error = $root.MumbleProto.UserStats.Stats.verify(message.from_client, _depth + 1);
                if (error)
                    return "from_client." + error;
            }
            if (message.from_server != null && $Object.hasOwnProperty.call(message, "from_server")) {
                let error = $root.MumbleProto.UserStats.Stats.verify(message.from_server, _depth + 1);
                if (error)
                    return "from_server." + error;
            }
            if (message.udp_packets != null && $Object.hasOwnProperty.call(message, "udp_packets"))
                if (!$util.isInteger(message.udp_packets))
                    return "udp_packets: integer expected";
            if (message.tcp_packets != null && $Object.hasOwnProperty.call(message, "tcp_packets"))
                if (!$util.isInteger(message.tcp_packets))
                    return "tcp_packets: integer expected";
            if (message.udp_ping_avg != null && $Object.hasOwnProperty.call(message, "udp_ping_avg"))
                if (typeof message.udp_ping_avg !== "number")
                    return "udp_ping_avg: number expected";
            if (message.udp_ping_var != null && $Object.hasOwnProperty.call(message, "udp_ping_var"))
                if (typeof message.udp_ping_var !== "number")
                    return "udp_ping_var: number expected";
            if (message.tcp_ping_avg != null && $Object.hasOwnProperty.call(message, "tcp_ping_avg"))
                if (typeof message.tcp_ping_avg !== "number")
                    return "tcp_ping_avg: number expected";
            if (message.tcp_ping_var != null && $Object.hasOwnProperty.call(message, "tcp_ping_var"))
                if (typeof message.tcp_ping_var !== "number")
                    return "tcp_ping_var: number expected";
            if (message.version != null && $Object.hasOwnProperty.call(message, "version")) {
                let error = $root.MumbleProto.Version.verify(message.version, _depth + 1);
                if (error)
                    return "version." + error;
            }
            if (message.celt_versions != null && $Object.hasOwnProperty.call(message, "celt_versions")) {
                if (!$Array.isArray(message.celt_versions))
                    return "celt_versions: array expected";
                for (let i = 0; i < message.celt_versions.length; ++i)
                    if (!$util.isInteger(message.celt_versions[i]))
                        return "celt_versions: integer[] expected";
            }
            if (message.address != null && $Object.hasOwnProperty.call(message, "address"))
                if (!(message.address && typeof message.address.length === "number" || $util.isString(message.address)))
                    return "address: buffer expected";
            if (message.bandwidth != null && $Object.hasOwnProperty.call(message, "bandwidth"))
                if (!$util.isInteger(message.bandwidth))
                    return "bandwidth: integer expected";
            if (message.onlinesecs != null && $Object.hasOwnProperty.call(message, "onlinesecs"))
                if (!$util.isInteger(message.onlinesecs))
                    return "onlinesecs: integer expected";
            if (message.idlesecs != null && $Object.hasOwnProperty.call(message, "idlesecs"))
                if (!$util.isInteger(message.idlesecs))
                    return "idlesecs: integer expected";
            if (message.strong_certificate != null && $Object.hasOwnProperty.call(message, "strong_certificate"))
                if (typeof message.strong_certificate !== "boolean")
                    return "strong_certificate: boolean expected";
            if (message.opus != null && $Object.hasOwnProperty.call(message, "opus"))
                if (typeof message.opus !== "boolean")
                    return "opus: boolean expected";
            if (message.rolling_stats != null && $Object.hasOwnProperty.call(message, "rolling_stats")) {
                let error = $root.MumbleProto.UserStats.RollingStats.verify(message.rolling_stats, _depth + 1);
                if (error)
                    return "rolling_stats." + error;
            }
            return null;
        };

        UserStats.fromObject = function (object, _depth) {
            if (object instanceof $root.MumbleProto.UserStats)
                return object;
            if (!$util.isObject(object))
                throw $TypeError(".MumbleProto.UserStats: object expected");
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let message = new $root.MumbleProto.UserStats();
            if (object.session != null)
                message.session = object.session >>> 0;
            if (object.stats_only != null)
                message.stats_only = $Boolean(object.stats_only);
            if (object.certificates) {
                if (!$Array.isArray(object.certificates))
                    throw $TypeError(".MumbleProto.UserStats.certificates: array expected");
                message.certificates = $Array(object.certificates.length);
                for (let i = 0; i < object.certificates.length; ++i)
                    if (typeof object.certificates[i] === "string")
                        $util.base64.decode(object.certificates[i], message.certificates[i] = $util.newBuffer($util.base64.length(object.certificates[i])), 0);
                    else if (object.certificates[i].length >= 0)
                        message.certificates[i] = object.certificates[i];
            }
            if (object.from_client != null) {
                if (!$util.isObject(object.from_client))
                    throw $TypeError(".MumbleProto.UserStats.from_client: object expected");
                message.from_client = $root.MumbleProto.UserStats.Stats.fromObject(object.from_client, _depth + 1);
            }
            if (object.from_server != null) {
                if (!$util.isObject(object.from_server))
                    throw $TypeError(".MumbleProto.UserStats.from_server: object expected");
                message.from_server = $root.MumbleProto.UserStats.Stats.fromObject(object.from_server, _depth + 1);
            }
            if (object.udp_packets != null)
                message.udp_packets = object.udp_packets >>> 0;
            if (object.tcp_packets != null)
                message.tcp_packets = object.tcp_packets >>> 0;
            if (object.udp_ping_avg != null)
                message.udp_ping_avg = $Number(object.udp_ping_avg);
            if (object.udp_ping_var != null)
                message.udp_ping_var = $Number(object.udp_ping_var);
            if (object.tcp_ping_avg != null)
                message.tcp_ping_avg = $Number(object.tcp_ping_avg);
            if (object.tcp_ping_var != null)
                message.tcp_ping_var = $Number(object.tcp_ping_var);
            if (object.version != null) {
                if (!$util.isObject(object.version))
                    throw $TypeError(".MumbleProto.UserStats.version: object expected");
                message.version = $root.MumbleProto.Version.fromObject(object.version, _depth + 1);
            }
            if (object.celt_versions) {
                if (!$Array.isArray(object.celt_versions))
                    throw $TypeError(".MumbleProto.UserStats.celt_versions: array expected");
                message.celt_versions = $Array(object.celt_versions.length);
                for (let i = 0; i < object.celt_versions.length; ++i)
                    message.celt_versions[i] = object.celt_versions[i] | 0;
            }
            if (object.address != null)
                if (typeof object.address === "string")
                    $util.base64.decode(object.address, message.address = $util.newBuffer($util.base64.length(object.address)), 0);
                else if (object.address.length >= 0)
                    message.address = object.address;
            if (object.bandwidth != null)
                message.bandwidth = object.bandwidth >>> 0;
            if (object.onlinesecs != null)
                message.onlinesecs = object.onlinesecs >>> 0;
            if (object.idlesecs != null)
                message.idlesecs = object.idlesecs >>> 0;
            if (object.strong_certificate != null)
                message.strong_certificate = $Boolean(object.strong_certificate);
            if (object.opus != null)
                message.opus = $Boolean(object.opus);
            if (object.rolling_stats != null) {
                if (!$util.isObject(object.rolling_stats))
                    throw $TypeError(".MumbleProto.UserStats.rolling_stats: object expected");
                message.rolling_stats = $root.MumbleProto.UserStats.RollingStats.fromObject(object.rolling_stats, _depth + 1);
            }
            return message;
        };

        UserStats.toObject = function (message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let object = {};
            if (options.arrays || options.defaults) {
                object.certificates = [];
                object.celt_versions = [];
            }
            if (options.defaults) {
                object.session = 0;
                object.stats_only = false;
                object.from_client = null;
                object.from_server = null;
                object.udp_packets = 0;
                object.tcp_packets = 0;
                object.udp_ping_avg = 0;
                object.udp_ping_var = 0;
                object.tcp_ping_avg = 0;
                object.tcp_ping_var = 0;
                object.version = null;
                if (options.bytes === $String)
                    object.address = "";
                else {
                    object.address = [];
                    if (options.bytes !== $Array)
                        object.address = $util.newBuffer(object.address);
                }
                object.bandwidth = 0;
                object.onlinesecs = 0;
                object.idlesecs = 0;
                object.strong_certificate = false;
                object.opus = false;
                object.rolling_stats = null;
            }
            if (message.session != null && $Object.hasOwnProperty.call(message, "session"))
                object.session = message.session;
            if (message.stats_only != null && $Object.hasOwnProperty.call(message, "stats_only"))
                object.stats_only = message.stats_only;
            if (message.certificates && message.certificates.length) {
                object.certificates = $Array(message.certificates.length);
                for (let j = 0; j < message.certificates.length; ++j)
                    object.certificates[j] = options.bytes === $String ? $util.base64.encode(message.certificates[j], 0, message.certificates[j].length) : options.bytes === $Array ? $Array.prototype.slice.call(message.certificates[j]) : message.certificates[j];
            }
            if (message.from_client != null && $Object.hasOwnProperty.call(message, "from_client"))
                object.from_client = $root.MumbleProto.UserStats.Stats.toObject(message.from_client, options, _depth + 1);
            if (message.from_server != null && $Object.hasOwnProperty.call(message, "from_server"))
                object.from_server = $root.MumbleProto.UserStats.Stats.toObject(message.from_server, options, _depth + 1);
            if (message.udp_packets != null && $Object.hasOwnProperty.call(message, "udp_packets"))
                object.udp_packets = message.udp_packets;
            if (message.tcp_packets != null && $Object.hasOwnProperty.call(message, "tcp_packets"))
                object.tcp_packets = message.tcp_packets;
            if (message.udp_ping_avg != null && $Object.hasOwnProperty.call(message, "udp_ping_avg"))
                object.udp_ping_avg = options.json && !$isFinite(message.udp_ping_avg) ? $String(message.udp_ping_avg) : message.udp_ping_avg;
            if (message.udp_ping_var != null && $Object.hasOwnProperty.call(message, "udp_ping_var"))
                object.udp_ping_var = options.json && !$isFinite(message.udp_ping_var) ? $String(message.udp_ping_var) : message.udp_ping_var;
            if (message.tcp_ping_avg != null && $Object.hasOwnProperty.call(message, "tcp_ping_avg"))
                object.tcp_ping_avg = options.json && !$isFinite(message.tcp_ping_avg) ? $String(message.tcp_ping_avg) : message.tcp_ping_avg;
            if (message.tcp_ping_var != null && $Object.hasOwnProperty.call(message, "tcp_ping_var"))
                object.tcp_ping_var = options.json && !$isFinite(message.tcp_ping_var) ? $String(message.tcp_ping_var) : message.tcp_ping_var;
            if (message.version != null && $Object.hasOwnProperty.call(message, "version"))
                object.version = $root.MumbleProto.Version.toObject(message.version, options, _depth + 1);
            if (message.celt_versions && message.celt_versions.length) {
                object.celt_versions = $Array(message.celt_versions.length);
                for (let j = 0; j < message.celt_versions.length; ++j)
                    object.celt_versions[j] = message.celt_versions[j];
            }
            if (message.address != null && $Object.hasOwnProperty.call(message, "address"))
                object.address = options.bytes === $String ? $util.base64.encode(message.address, 0, message.address.length) : options.bytes === $Array ? $Array.prototype.slice.call(message.address) : message.address;
            if (message.bandwidth != null && $Object.hasOwnProperty.call(message, "bandwidth"))
                object.bandwidth = message.bandwidth;
            if (message.onlinesecs != null && $Object.hasOwnProperty.call(message, "onlinesecs"))
                object.onlinesecs = message.onlinesecs;
            if (message.idlesecs != null && $Object.hasOwnProperty.call(message, "idlesecs"))
                object.idlesecs = message.idlesecs;
            if (message.strong_certificate != null && $Object.hasOwnProperty.call(message, "strong_certificate"))
                object.strong_certificate = message.strong_certificate;
            if (message.opus != null && $Object.hasOwnProperty.call(message, "opus"))
                object.opus = message.opus;
            if (message.rolling_stats != null && $Object.hasOwnProperty.call(message, "rolling_stats"))
                object.rolling_stats = $root.MumbleProto.UserStats.RollingStats.toObject(message.rolling_stats, options, _depth + 1);
            return object;
        };

        UserStats.prototype.toJSON = function() {
            return UserStats.toObject(this, $protobuf.util.toJSONOptions);
        };

        UserStats.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/MumbleProto.UserStats";
        };

        UserStats.Stats = (function() {

            const Stats = function (properties) {
                if (properties)
                    for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null && keys[i] !== "__proto__")
                            this[keys[i]] = properties[keys[i]];
            };

            Stats.prototype.good = 0;
            Stats.prototype.late = 0;
            Stats.prototype.lost = 0;
            Stats.prototype.resync = 0;

            Stats.create = function(properties) {
                return new Stats(properties);
            };

            Stats.encode = function (message, writer, _depth) {
                if (!writer)
                    writer = $Writer.create();
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (message.good != null && $Object.hasOwnProperty.call(message, "good"))
                    writer.uint32(8).uint32(message.good);
                if (message.late != null && $Object.hasOwnProperty.call(message, "late"))
                    writer.uint32(16).uint32(message.late);
                if (message.lost != null && $Object.hasOwnProperty.call(message, "lost"))
                    writer.uint32(24).uint32(message.lost);
                if (message.resync != null && $Object.hasOwnProperty.call(message, "resync"))
                    writer.uint32(32).uint32(message.resync);
                if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                    for (let i = 0; i < message.$unknowns.length; ++i)
                        writer.raw(message.$unknowns[i]);
                return writer;
            };

            Stats.decode = function (reader, length, _end, _depth, _target) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                let end, message;
                if (length === $undefined)
                    end = reader.len;
                else {
                    end = reader.pos + length;
                    if (end > reader.len)
                        throw $RangeError("index out of range");
                    length = reader.len;
                    reader.len = end;
                }
                message = _target || new $root.MumbleProto.UserStats.Stats();
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
                            message.good = reader.uint32();
                            continue;
                        }
                    case 2: {
                            if (wireType !== 0)
                                break;
                            message.late = reader.uint32();
                            continue;
                        }
                    case 3: {
                            if (wireType !== 0)
                                break;
                            message.lost = reader.uint32();
                            continue;
                        }
                    case 4: {
                            if (wireType !== 0)
                                break;
                            message.resync = reader.uint32();
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

            Stats.verify = function (message, _depth) {
                if (typeof message !== "object" || message === null)
                    return "object expected";
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    return "max depth exceeded";
                if (message.good != null && $Object.hasOwnProperty.call(message, "good"))
                    if (!$util.isInteger(message.good))
                        return "good: integer expected";
                if (message.late != null && $Object.hasOwnProperty.call(message, "late"))
                    if (!$util.isInteger(message.late))
                        return "late: integer expected";
                if (message.lost != null && $Object.hasOwnProperty.call(message, "lost"))
                    if (!$util.isInteger(message.lost))
                        return "lost: integer expected";
                if (message.resync != null && $Object.hasOwnProperty.call(message, "resync"))
                    if (!$util.isInteger(message.resync))
                        return "resync: integer expected";
                return null;
            };

            Stats.fromObject = function (object, _depth) {
                if (object instanceof $root.MumbleProto.UserStats.Stats)
                    return object;
                if (!$util.isObject(object))
                    throw $TypeError(".MumbleProto.UserStats.Stats: object expected");
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                let message = new $root.MumbleProto.UserStats.Stats();
                if (object.good != null)
                    message.good = object.good >>> 0;
                if (object.late != null)
                    message.late = object.late >>> 0;
                if (object.lost != null)
                    message.lost = object.lost >>> 0;
                if (object.resync != null)
                    message.resync = object.resync >>> 0;
                return message;
            };

            Stats.toObject = function (message, options, _depth) {
                if (!options)
                    options = {};
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                let object = {};
                if (options.defaults) {
                    object.good = 0;
                    object.late = 0;
                    object.lost = 0;
                    object.resync = 0;
                }
                if (message.good != null && $Object.hasOwnProperty.call(message, "good"))
                    object.good = message.good;
                if (message.late != null && $Object.hasOwnProperty.call(message, "late"))
                    object.late = message.late;
                if (message.lost != null && $Object.hasOwnProperty.call(message, "lost"))
                    object.lost = message.lost;
                if (message.resync != null && $Object.hasOwnProperty.call(message, "resync"))
                    object.resync = message.resync;
                return object;
            };

            Stats.prototype.toJSON = function() {
                return Stats.toObject(this, $protobuf.util.toJSONOptions);
            };

            Stats.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/MumbleProto.UserStats.Stats";
            };

            return Stats;
        })();

        UserStats.RollingStats = (function() {

            const RollingStats = function (properties) {
                if (properties)
                    for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null && keys[i] !== "__proto__")
                            this[keys[i]] = properties[keys[i]];
            };

            RollingStats.prototype.time_window = 0;
            RollingStats.prototype.from_client = null;
            RollingStats.prototype.from_server = null;

            RollingStats.create = function(properties) {
                return new RollingStats(properties);
            };

            RollingStats.encode = function (message, writer, _depth) {
                if (!writer)
                    writer = $Writer.create();
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (message.time_window != null && $Object.hasOwnProperty.call(message, "time_window"))
                    writer.uint32(8).uint32(message.time_window);
                if (message.from_client != null && $Object.hasOwnProperty.call(message, "from_client"))
                    $root.MumbleProto.UserStats.Stats.encode(message.from_client, writer.uint32(18).fork(), _depth + 1).ldelim();
                if (message.from_server != null && $Object.hasOwnProperty.call(message, "from_server"))
                    $root.MumbleProto.UserStats.Stats.encode(message.from_server, writer.uint32(26).fork(), _depth + 1).ldelim();
                if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                    for (let i = 0; i < message.$unknowns.length; ++i)
                        writer.raw(message.$unknowns[i]);
                return writer;
            };

            RollingStats.decode = function (reader, length, _end, _depth, _target) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                let end, message;
                if (length === $undefined)
                    end = reader.len;
                else {
                    end = reader.pos + length;
                    if (end > reader.len)
                        throw $RangeError("index out of range");
                    length = reader.len;
                    reader.len = end;
                }
                message = _target || new $root.MumbleProto.UserStats.RollingStats();
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
                            message.time_window = reader.uint32();
                            continue;
                        }
                    case 2: {
                            if (wireType !== 2)
                                break;
                            message.from_client = $root.MumbleProto.UserStats.Stats.decode(reader, reader.uint32(), $undefined, _depth + 1, message.from_client);
                            continue;
                        }
                    case 3: {
                            if (wireType !== 2)
                                break;
                            message.from_server = $root.MumbleProto.UserStats.Stats.decode(reader, reader.uint32(), $undefined, _depth + 1, message.from_server);
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

            RollingStats.verify = function (message, _depth) {
                if (typeof message !== "object" || message === null)
                    return "object expected";
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    return "max depth exceeded";
                if (message.time_window != null && $Object.hasOwnProperty.call(message, "time_window"))
                    if (!$util.isInteger(message.time_window))
                        return "time_window: integer expected";
                if (message.from_client != null && $Object.hasOwnProperty.call(message, "from_client")) {
                    let error = $root.MumbleProto.UserStats.Stats.verify(message.from_client, _depth + 1);
                    if (error)
                        return "from_client." + error;
                }
                if (message.from_server != null && $Object.hasOwnProperty.call(message, "from_server")) {
                    let error = $root.MumbleProto.UserStats.Stats.verify(message.from_server, _depth + 1);
                    if (error)
                        return "from_server." + error;
                }
                return null;
            };

            RollingStats.fromObject = function (object, _depth) {
                if (object instanceof $root.MumbleProto.UserStats.RollingStats)
                    return object;
                if (!$util.isObject(object))
                    throw $TypeError(".MumbleProto.UserStats.RollingStats: object expected");
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                let message = new $root.MumbleProto.UserStats.RollingStats();
                if (object.time_window != null)
                    message.time_window = object.time_window >>> 0;
                if (object.from_client != null) {
                    if (!$util.isObject(object.from_client))
                        throw $TypeError(".MumbleProto.UserStats.RollingStats.from_client: object expected");
                    message.from_client = $root.MumbleProto.UserStats.Stats.fromObject(object.from_client, _depth + 1);
                }
                if (object.from_server != null) {
                    if (!$util.isObject(object.from_server))
                        throw $TypeError(".MumbleProto.UserStats.RollingStats.from_server: object expected");
                    message.from_server = $root.MumbleProto.UserStats.Stats.fromObject(object.from_server, _depth + 1);
                }
                return message;
            };

            RollingStats.toObject = function (message, options, _depth) {
                if (!options)
                    options = {};
                if (_depth === $undefined)
                    _depth = 0;
                if (_depth > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                let object = {};
                if (options.defaults) {
                    object.time_window = 0;
                    object.from_client = null;
                    object.from_server = null;
                }
                if (message.time_window != null && $Object.hasOwnProperty.call(message, "time_window"))
                    object.time_window = message.time_window;
                if (message.from_client != null && $Object.hasOwnProperty.call(message, "from_client"))
                    object.from_client = $root.MumbleProto.UserStats.Stats.toObject(message.from_client, options, _depth + 1);
                if (message.from_server != null && $Object.hasOwnProperty.call(message, "from_server"))
                    object.from_server = $root.MumbleProto.UserStats.Stats.toObject(message.from_server, options, _depth + 1);
                return object;
            };

            RollingStats.prototype.toJSON = function() {
                return RollingStats.toObject(this, $protobuf.util.toJSONOptions);
            };

            RollingStats.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/MumbleProto.UserStats.RollingStats";
            };

            return RollingStats;
        })();

        return UserStats;
    })();

    MumbleProto.RequestBlob = (function() {

        const RequestBlob = function (properties) {
            this.session_texture = [];
            this.session_comment = [];
            this.channel_description = [];
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        RequestBlob.prototype.session_texture = $util.emptyArray;
        RequestBlob.prototype.session_comment = $util.emptyArray;
        RequestBlob.prototype.channel_description = $util.emptyArray;

        RequestBlob.create = function(properties) {
            return new RequestBlob(properties);
        };

        RequestBlob.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.session_texture != null && message.session_texture.length)
                for (let i = 0; i < message.session_texture.length; ++i)
                    writer.uint32(8).uint32(message.session_texture[i]);
            if (message.session_comment != null && message.session_comment.length)
                for (let i = 0; i < message.session_comment.length; ++i)
                    writer.uint32(16).uint32(message.session_comment[i]);
            if (message.channel_description != null && message.channel_description.length)
                for (let i = 0; i < message.channel_description.length; ++i)
                    writer.uint32(24).uint32(message.channel_description[i]);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        RequestBlob.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end, message;
            if (length === $undefined)
                end = reader.len;
            else {
                end = reader.pos + length;
                if (end > reader.len)
                    throw $RangeError("index out of range");
                length = reader.len;
                reader.len = end;
            }
            message = _target || new $root.MumbleProto.RequestBlob();
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
                        if (wireType === 2) {
                            if (!(message.session_texture && message.session_texture.length))
                                message.session_texture = [];
                            reader.uint32s(message.session_texture);
                            continue;
                        }
                        if (wireType !== 0)
                            break;
                        if (!(message.session_texture && message.session_texture.length))
                            message.session_texture = [];
                        message.session_texture.push(reader.uint32());
                        continue;
                    }
                case 2: {
                        if (wireType === 2) {
                            if (!(message.session_comment && message.session_comment.length))
                                message.session_comment = [];
                            reader.uint32s(message.session_comment);
                            continue;
                        }
                        if (wireType !== 0)
                            break;
                        if (!(message.session_comment && message.session_comment.length))
                            message.session_comment = [];
                        message.session_comment.push(reader.uint32());
                        continue;
                    }
                case 3: {
                        if (wireType === 2) {
                            if (!(message.channel_description && message.channel_description.length))
                                message.channel_description = [];
                            reader.uint32s(message.channel_description);
                            continue;
                        }
                        if (wireType !== 0)
                            break;
                        if (!(message.channel_description && message.channel_description.length))
                            message.channel_description = [];
                        message.channel_description.push(reader.uint32());
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

        RequestBlob.verify = function (message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (message.session_texture != null && $Object.hasOwnProperty.call(message, "session_texture")) {
                if (!$Array.isArray(message.session_texture))
                    return "session_texture: array expected";
                for (let i = 0; i < message.session_texture.length; ++i)
                    if (!$util.isInteger(message.session_texture[i]))
                        return "session_texture: integer[] expected";
            }
            if (message.session_comment != null && $Object.hasOwnProperty.call(message, "session_comment")) {
                if (!$Array.isArray(message.session_comment))
                    return "session_comment: array expected";
                for (let i = 0; i < message.session_comment.length; ++i)
                    if (!$util.isInteger(message.session_comment[i]))
                        return "session_comment: integer[] expected";
            }
            if (message.channel_description != null && $Object.hasOwnProperty.call(message, "channel_description")) {
                if (!$Array.isArray(message.channel_description))
                    return "channel_description: array expected";
                for (let i = 0; i < message.channel_description.length; ++i)
                    if (!$util.isInteger(message.channel_description[i]))
                        return "channel_description: integer[] expected";
            }
            return null;
        };

        RequestBlob.fromObject = function (object, _depth) {
            if (object instanceof $root.MumbleProto.RequestBlob)
                return object;
            if (!$util.isObject(object))
                throw $TypeError(".MumbleProto.RequestBlob: object expected");
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let message = new $root.MumbleProto.RequestBlob();
            if (object.session_texture) {
                if (!$Array.isArray(object.session_texture))
                    throw $TypeError(".MumbleProto.RequestBlob.session_texture: array expected");
                message.session_texture = $Array(object.session_texture.length);
                for (let i = 0; i < object.session_texture.length; ++i)
                    message.session_texture[i] = object.session_texture[i] >>> 0;
            }
            if (object.session_comment) {
                if (!$Array.isArray(object.session_comment))
                    throw $TypeError(".MumbleProto.RequestBlob.session_comment: array expected");
                message.session_comment = $Array(object.session_comment.length);
                for (let i = 0; i < object.session_comment.length; ++i)
                    message.session_comment[i] = object.session_comment[i] >>> 0;
            }
            if (object.channel_description) {
                if (!$Array.isArray(object.channel_description))
                    throw $TypeError(".MumbleProto.RequestBlob.channel_description: array expected");
                message.channel_description = $Array(object.channel_description.length);
                for (let i = 0; i < object.channel_description.length; ++i)
                    message.channel_description[i] = object.channel_description[i] >>> 0;
            }
            return message;
        };

        RequestBlob.toObject = function (message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let object = {};
            if (options.arrays || options.defaults) {
                object.session_texture = [];
                object.session_comment = [];
                object.channel_description = [];
            }
            if (message.session_texture && message.session_texture.length) {
                object.session_texture = $Array(message.session_texture.length);
                for (let j = 0; j < message.session_texture.length; ++j)
                    object.session_texture[j] = message.session_texture[j];
            }
            if (message.session_comment && message.session_comment.length) {
                object.session_comment = $Array(message.session_comment.length);
                for (let j = 0; j < message.session_comment.length; ++j)
                    object.session_comment[j] = message.session_comment[j];
            }
            if (message.channel_description && message.channel_description.length) {
                object.channel_description = $Array(message.channel_description.length);
                for (let j = 0; j < message.channel_description.length; ++j)
                    object.channel_description[j] = message.channel_description[j];
            }
            return object;
        };

        RequestBlob.prototype.toJSON = function() {
            return RequestBlob.toObject(this, $protobuf.util.toJSONOptions);
        };

        RequestBlob.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/MumbleProto.RequestBlob";
        };

        return RequestBlob;
    })();

    MumbleProto.ServerConfig = (function() {

        const ServerConfig = function (properties) {
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        ServerConfig.prototype.max_bandwidth = 0;
        ServerConfig.prototype.welcome_text = "";
        ServerConfig.prototype.allow_html = false;
        ServerConfig.prototype.message_length = 0;
        ServerConfig.prototype.image_message_length = 0;
        ServerConfig.prototype.max_users = 0;
        ServerConfig.prototype.recording_allowed = false;

        ServerConfig.create = function(properties) {
            return new ServerConfig(properties);
        };

        ServerConfig.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.max_bandwidth != null && $Object.hasOwnProperty.call(message, "max_bandwidth"))
                writer.uint32(8).uint32(message.max_bandwidth);
            if (message.welcome_text != null && $Object.hasOwnProperty.call(message, "welcome_text"))
                writer.uint32(18).string(message.welcome_text);
            if (message.allow_html != null && $Object.hasOwnProperty.call(message, "allow_html"))
                writer.uint32(24).bool(message.allow_html);
            if (message.message_length != null && $Object.hasOwnProperty.call(message, "message_length"))
                writer.uint32(32).uint32(message.message_length);
            if (message.image_message_length != null && $Object.hasOwnProperty.call(message, "image_message_length"))
                writer.uint32(40).uint32(message.image_message_length);
            if (message.max_users != null && $Object.hasOwnProperty.call(message, "max_users"))
                writer.uint32(48).uint32(message.max_users);
            if (message.recording_allowed != null && $Object.hasOwnProperty.call(message, "recording_allowed"))
                writer.uint32(56).bool(message.recording_allowed);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        ServerConfig.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end, message;
            if (length === $undefined)
                end = reader.len;
            else {
                end = reader.pos + length;
                if (end > reader.len)
                    throw $RangeError("index out of range");
                length = reader.len;
                reader.len = end;
            }
            message = _target || new $root.MumbleProto.ServerConfig();
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
                        message.max_bandwidth = reader.uint32();
                        continue;
                    }
                case 2: {
                        if (wireType !== 2)
                            break;
                        message.welcome_text = reader.string();
                        continue;
                    }
                case 3: {
                        if (wireType !== 0)
                            break;
                        message.allow_html = reader.bool();
                        continue;
                    }
                case 4: {
                        if (wireType !== 0)
                            break;
                        message.message_length = reader.uint32();
                        continue;
                    }
                case 5: {
                        if (wireType !== 0)
                            break;
                        message.image_message_length = reader.uint32();
                        continue;
                    }
                case 6: {
                        if (wireType !== 0)
                            break;
                        message.max_users = reader.uint32();
                        continue;
                    }
                case 7: {
                        if (wireType !== 0)
                            break;
                        message.recording_allowed = reader.bool();
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

        ServerConfig.verify = function (message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (message.max_bandwidth != null && $Object.hasOwnProperty.call(message, "max_bandwidth"))
                if (!$util.isInteger(message.max_bandwidth))
                    return "max_bandwidth: integer expected";
            if (message.welcome_text != null && $Object.hasOwnProperty.call(message, "welcome_text"))
                if (!$util.isString(message.welcome_text))
                    return "welcome_text: string expected";
            if (message.allow_html != null && $Object.hasOwnProperty.call(message, "allow_html"))
                if (typeof message.allow_html !== "boolean")
                    return "allow_html: boolean expected";
            if (message.message_length != null && $Object.hasOwnProperty.call(message, "message_length"))
                if (!$util.isInteger(message.message_length))
                    return "message_length: integer expected";
            if (message.image_message_length != null && $Object.hasOwnProperty.call(message, "image_message_length"))
                if (!$util.isInteger(message.image_message_length))
                    return "image_message_length: integer expected";
            if (message.max_users != null && $Object.hasOwnProperty.call(message, "max_users"))
                if (!$util.isInteger(message.max_users))
                    return "max_users: integer expected";
            if (message.recording_allowed != null && $Object.hasOwnProperty.call(message, "recording_allowed"))
                if (typeof message.recording_allowed !== "boolean")
                    return "recording_allowed: boolean expected";
            return null;
        };

        ServerConfig.fromObject = function (object, _depth) {
            if (object instanceof $root.MumbleProto.ServerConfig)
                return object;
            if (!$util.isObject(object))
                throw $TypeError(".MumbleProto.ServerConfig: object expected");
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let message = new $root.MumbleProto.ServerConfig();
            if (object.max_bandwidth != null)
                message.max_bandwidth = object.max_bandwidth >>> 0;
            if (object.welcome_text != null)
                message.welcome_text = $String(object.welcome_text);
            if (object.allow_html != null)
                message.allow_html = $Boolean(object.allow_html);
            if (object.message_length != null)
                message.message_length = object.message_length >>> 0;
            if (object.image_message_length != null)
                message.image_message_length = object.image_message_length >>> 0;
            if (object.max_users != null)
                message.max_users = object.max_users >>> 0;
            if (object.recording_allowed != null)
                message.recording_allowed = $Boolean(object.recording_allowed);
            return message;
        };

        ServerConfig.toObject = function (message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let object = {};
            if (options.defaults) {
                object.max_bandwidth = 0;
                object.welcome_text = "";
                object.allow_html = false;
                object.message_length = 0;
                object.image_message_length = 0;
                object.max_users = 0;
                object.recording_allowed = false;
            }
            if (message.max_bandwidth != null && $Object.hasOwnProperty.call(message, "max_bandwidth"))
                object.max_bandwidth = message.max_bandwidth;
            if (message.welcome_text != null && $Object.hasOwnProperty.call(message, "welcome_text"))
                object.welcome_text = message.welcome_text;
            if (message.allow_html != null && $Object.hasOwnProperty.call(message, "allow_html"))
                object.allow_html = message.allow_html;
            if (message.message_length != null && $Object.hasOwnProperty.call(message, "message_length"))
                object.message_length = message.message_length;
            if (message.image_message_length != null && $Object.hasOwnProperty.call(message, "image_message_length"))
                object.image_message_length = message.image_message_length;
            if (message.max_users != null && $Object.hasOwnProperty.call(message, "max_users"))
                object.max_users = message.max_users;
            if (message.recording_allowed != null && $Object.hasOwnProperty.call(message, "recording_allowed"))
                object.recording_allowed = message.recording_allowed;
            return object;
        };

        ServerConfig.prototype.toJSON = function() {
            return ServerConfig.toObject(this, $protobuf.util.toJSONOptions);
        };

        ServerConfig.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/MumbleProto.ServerConfig";
        };

        return ServerConfig;
    })();

    MumbleProto.SuggestConfig = (function() {

        const SuggestConfig = function (properties) {
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        SuggestConfig.prototype.version_v1 = 0;
        SuggestConfig.prototype.version_v2 = $util.Long ? $util.Long.fromBits(0,0,true) : 0;
        SuggestConfig.prototype.positional = false;
        SuggestConfig.prototype.push_to_talk = false;

        SuggestConfig.create = function(properties) {
            return new SuggestConfig(properties);
        };

        SuggestConfig.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.version_v1 != null && $Object.hasOwnProperty.call(message, "version_v1"))
                writer.uint32(8).uint32(message.version_v1);
            if (message.positional != null && $Object.hasOwnProperty.call(message, "positional"))
                writer.uint32(16).bool(message.positional);
            if (message.push_to_talk != null && $Object.hasOwnProperty.call(message, "push_to_talk"))
                writer.uint32(24).bool(message.push_to_talk);
            if (message.version_v2 != null && $Object.hasOwnProperty.call(message, "version_v2"))
                writer.uint32(32).uint64(message.version_v2);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        SuggestConfig.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end, message;
            if (length === $undefined)
                end = reader.len;
            else {
                end = reader.pos + length;
                if (end > reader.len)
                    throw $RangeError("index out of range");
                length = reader.len;
                reader.len = end;
            }
            message = _target || new $root.MumbleProto.SuggestConfig();
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
                        message.version_v1 = reader.uint32();
                        continue;
                    }
                case 4: {
                        if (wireType !== 0)
                            break;
                        message.version_v2 = reader.uint64();
                        continue;
                    }
                case 2: {
                        if (wireType !== 0)
                            break;
                        message.positional = reader.bool();
                        continue;
                    }
                case 3: {
                        if (wireType !== 0)
                            break;
                        message.push_to_talk = reader.bool();
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

        SuggestConfig.verify = function (message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (message.version_v1 != null && $Object.hasOwnProperty.call(message, "version_v1"))
                if (!$util.isInteger(message.version_v1))
                    return "version_v1: integer expected";
            if (message.version_v2 != null && $Object.hasOwnProperty.call(message, "version_v2"))
                if (!$util.isInteger(message.version_v2) && !(message.version_v2 && $util.isInteger(message.version_v2.low) && $util.isInteger(message.version_v2.high)))
                    return "version_v2: integer|Long expected";
            if (message.positional != null && $Object.hasOwnProperty.call(message, "positional"))
                if (typeof message.positional !== "boolean")
                    return "positional: boolean expected";
            if (message.push_to_talk != null && $Object.hasOwnProperty.call(message, "push_to_talk"))
                if (typeof message.push_to_talk !== "boolean")
                    return "push_to_talk: boolean expected";
            return null;
        };

        SuggestConfig.fromObject = function (object, _depth) {
            if (object instanceof $root.MumbleProto.SuggestConfig)
                return object;
            if (!$util.isObject(object))
                throw $TypeError(".MumbleProto.SuggestConfig: object expected");
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let message = new $root.MumbleProto.SuggestConfig();
            if (object.version_v1 != null)
                message.version_v1 = object.version_v1 >>> 0;
            if (object.version_v2 != null)
                if ($util.Long)
                    message.version_v2 = $util.Long.fromValue(object.version_v2, true);
                else if (typeof object.version_v2 === "string")
                    message.version_v2 = $parseInt(object.version_v2, 10);
                else if (typeof object.version_v2 === "number")
                    message.version_v2 = object.version_v2;
                else if (typeof object.version_v2 === "object")
                    message.version_v2 = new $util.LongBits(object.version_v2.low >>> 0, object.version_v2.high >>> 0).toNumber(true);
            if (object.positional != null)
                message.positional = $Boolean(object.positional);
            if (object.push_to_talk != null)
                message.push_to_talk = $Boolean(object.push_to_talk);
            return message;
        };

        SuggestConfig.toObject = function (message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let object = {};
            if (options.defaults) {
                object.version_v1 = 0;
                object.positional = false;
                object.push_to_talk = false;
                if ($util.Long) {
                    let long = new $util.Long(0, 0, true);
                    object.version_v2 = options.longs === $String ? long.toString() : options.longs === $Number ? long.toNumber() : typeof $BigInt !== "undefined" && options.longs === $BigInt ? long.toBigInt() : long;
                } else
                    object.version_v2 = options.longs === $String ? "0" : typeof $BigInt !== "undefined" && options.longs === $BigInt ? $BigInt("0") : 0;
            }
            if (message.version_v1 != null && $Object.hasOwnProperty.call(message, "version_v1"))
                object.version_v1 = message.version_v1;
            if (message.positional != null && $Object.hasOwnProperty.call(message, "positional"))
                object.positional = message.positional;
            if (message.push_to_talk != null && $Object.hasOwnProperty.call(message, "push_to_talk"))
                object.push_to_talk = message.push_to_talk;
            if (message.version_v2 != null && $Object.hasOwnProperty.call(message, "version_v2"))
                if (typeof $BigInt !== "undefined" && options.longs === $BigInt)
                    object.version_v2 = typeof message.version_v2 === "number" ? $BigInt(message.version_v2) : $util.Long.fromBits(message.version_v2.low >>> 0, message.version_v2.high >>> 0, true).toBigInt();
                else if (typeof message.version_v2 === "number")
                    object.version_v2 = options.longs === $String ? $String(message.version_v2) : message.version_v2;
                else
                    object.version_v2 = options.longs === $String ? $util.Long.prototype.toString.call(message.version_v2) : options.longs === $Number ? new $util.LongBits(message.version_v2.low >>> 0, message.version_v2.high >>> 0).toNumber(true) : message.version_v2;
            return object;
        };

        SuggestConfig.prototype.toJSON = function() {
            return SuggestConfig.toObject(this, $protobuf.util.toJSONOptions);
        };

        SuggestConfig.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/MumbleProto.SuggestConfig";
        };

        return SuggestConfig;
    })();

    MumbleProto.PluginDataTransmission = (function() {

        const PluginDataTransmission = function (properties) {
            this.receiverSessions = [];
            if (properties)
                for (let keys = $Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        };

        PluginDataTransmission.prototype.senderSession = 0;
        PluginDataTransmission.prototype.receiverSessions = $util.emptyArray;
        PluginDataTransmission.prototype.data = $util.newBuffer([]);
        PluginDataTransmission.prototype.dataID = "";

        PluginDataTransmission.create = function(properties) {
            return new PluginDataTransmission(properties);
        };

        PluginDataTransmission.encode = function (message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            if (message.senderSession != null && $Object.hasOwnProperty.call(message, "senderSession"))
                writer.uint32(8).uint32(message.senderSession);
            if (message.receiverSessions != null && message.receiverSessions.length)
                writer.uint32(18).uint32s(message.receiverSessions);
            if (message.data != null && $Object.hasOwnProperty.call(message, "data"))
                writer.uint32(26).bytes(message.data);
            if (message.dataID != null && $Object.hasOwnProperty.call(message, "dataID"))
                writer.uint32(34).string(message.dataID);
            if (message.$unknowns != null && $Object.hasOwnProperty.call(message, "$unknowns"))
                for (let i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        PluginDataTransmission.decode = function (reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw $Error("max depth exceeded");
            let end, message;
            if (length === $undefined)
                end = reader.len;
            else {
                end = reader.pos + length;
                if (end > reader.len)
                    throw $RangeError("index out of range");
                length = reader.len;
                reader.len = end;
            }
            message = _target || new $root.MumbleProto.PluginDataTransmission();
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
                        message.senderSession = reader.uint32();
                        continue;
                    }
                case 2: {
                        if (wireType === 2) {
                            if (!(message.receiverSessions && message.receiverSessions.length))
                                message.receiverSessions = [];
                            reader.uint32s(message.receiverSessions);
                            continue;
                        }
                        if (wireType !== 0)
                            break;
                        if (!(message.receiverSessions && message.receiverSessions.length))
                            message.receiverSessions = [];
                        message.receiverSessions.push(reader.uint32());
                        continue;
                    }
                case 3: {
                        if (wireType !== 2)
                            break;
                        message.data = reader.bytes();
                        continue;
                    }
                case 4: {
                        if (wireType !== 2)
                            break;
                        message.dataID = reader.string();
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

        PluginDataTransmission.verify = function (message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (message.senderSession != null && $Object.hasOwnProperty.call(message, "senderSession"))
                if (!$util.isInteger(message.senderSession))
                    return "senderSession: integer expected";
            if (message.receiverSessions != null && $Object.hasOwnProperty.call(message, "receiverSessions")) {
                if (!$Array.isArray(message.receiverSessions))
                    return "receiverSessions: array expected";
                for (let i = 0; i < message.receiverSessions.length; ++i)
                    if (!$util.isInteger(message.receiverSessions[i]))
                        return "receiverSessions: integer[] expected";
            }
            if (message.data != null && $Object.hasOwnProperty.call(message, "data"))
                if (!(message.data && typeof message.data.length === "number" || $util.isString(message.data)))
                    return "data: buffer expected";
            if (message.dataID != null && $Object.hasOwnProperty.call(message, "dataID"))
                if (!$util.isString(message.dataID))
                    return "dataID: string expected";
            return null;
        };

        PluginDataTransmission.fromObject = function (object, _depth) {
            if (object instanceof $root.MumbleProto.PluginDataTransmission)
                return object;
            if (!$util.isObject(object))
                throw $TypeError(".MumbleProto.PluginDataTransmission: object expected");
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let message = new $root.MumbleProto.PluginDataTransmission();
            if (object.senderSession != null)
                message.senderSession = object.senderSession >>> 0;
            if (object.receiverSessions) {
                if (!$Array.isArray(object.receiverSessions))
                    throw $TypeError(".MumbleProto.PluginDataTransmission.receiverSessions: array expected");
                message.receiverSessions = $Array(object.receiverSessions.length);
                for (let i = 0; i < object.receiverSessions.length; ++i)
                    message.receiverSessions[i] = object.receiverSessions[i] >>> 0;
            }
            if (object.data != null)
                if (typeof object.data === "string")
                    $util.base64.decode(object.data, message.data = $util.newBuffer($util.base64.length(object.data)), 0);
                else if (object.data.length >= 0)
                    message.data = object.data;
            if (object.dataID != null)
                message.dataID = $String(object.dataID);
            return message;
        };

        PluginDataTransmission.toObject = function (message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === $undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw $Error("max depth exceeded");
            let object = {};
            if (options.arrays || options.defaults)
                object.receiverSessions = [];
            if (options.defaults) {
                object.senderSession = 0;
                if (options.bytes === $String)
                    object.data = "";
                else {
                    object.data = [];
                    if (options.bytes !== $Array)
                        object.data = $util.newBuffer(object.data);
                }
                object.dataID = "";
            }
            if (message.senderSession != null && $Object.hasOwnProperty.call(message, "senderSession"))
                object.senderSession = message.senderSession;
            if (message.receiverSessions && message.receiverSessions.length) {
                object.receiverSessions = $Array(message.receiverSessions.length);
                for (let j = 0; j < message.receiverSessions.length; ++j)
                    object.receiverSessions[j] = message.receiverSessions[j];
            }
            if (message.data != null && $Object.hasOwnProperty.call(message, "data"))
                object.data = options.bytes === $String ? $util.base64.encode(message.data, 0, message.data.length) : options.bytes === $Array ? $Array.prototype.slice.call(message.data) : message.data;
            if (message.dataID != null && $Object.hasOwnProperty.call(message, "dataID"))
                object.dataID = message.dataID;
            return object;
        };

        PluginDataTransmission.prototype.toJSON = function() {
            return PluginDataTransmission.toObject(this, $protobuf.util.toJSONOptions);
        };

        PluginDataTransmission.getTypeUrl = function(prefix) {
            if (prefix === $undefined)
                prefix = "type.googleapis.com";
            return prefix + "/MumbleProto.PluginDataTransmission";
        };

        return PluginDataTransmission;
    })();

    return MumbleProto;
})();

export {
  $root as default
};
