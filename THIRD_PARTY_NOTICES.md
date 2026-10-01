# Third-party notices

## Mumble protocol definitions

`proto/Mumble.proto` and `proto/MumbleUDP.proto` are copied from the Mumble project
(https://github.com/mumble-voip/mumble). `src/core/mumble-pb.js` and `src/core/mumble-udp-pb.js`
are generated from them. They are covered by the following license:

```
Copyright (C) The Mumble Developers

All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:

- Redistributions of source code must retain the above copyright notice,
  this list of conditions and the following disclaimer.
- Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.
- Neither the name of The Mumble Developers nor the names of its
  contributors may be used to endorse or promote products derived from this
  software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE FOUNDATION OR
CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## npm dependencies

Runtime and build dependencies (Electron, Svelte, protobufjs, node-forge, DOMPurify and
others) are distributed under their own licenses, found in each package under `node_modules/`.

## @evan/opus and libopus

The Opus codec compiled to WebAssembly (`opus.wasm`), used for voice in browsers that have no
audio codec of their own. The package is MIT licensed, Copyright (c) 2021-present evanwashere.
libopus is under the three-clause BSD license, Copyright 2001-2011 Xiph.Org, Skype Limited,
Octasic, Jean-Marc Valin, Timothy B. Terriberry, CSIRO, Gregory Maxwell, Mark Borgerding,
Erik de Castro Lopo.
