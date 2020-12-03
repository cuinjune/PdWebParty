const isMobile = (typeof window.orientation !== "undefined") || (navigator.userAgent.indexOf('IEMobile') !== -1);
const canvas = document.getElementById("canvas");
const loading = document.getElementById("loading");
const filter = document.getElementById("filter");
let currentFile = "";
let canvasWidth = 450;
let canvasHeight = 300;
let fontSize = 12;
let subscribedData = {};

// create an AudioContext
const audioContextList = [];
(function () {
    var AudioContext = self.AudioContext || self.webkitAudioContext || false;
    if (AudioContext) {
        self.AudioContext = new Proxy(AudioContext, {
            construct(target, args) {
                const result = new target(...args);
                audioContextList.push(result);
                return result;
            }
        });
    }
    else {
        alert("The Web Audio API is not supported in this browser.");
    }
})();

function resumeAudio() {
    audioContextList.forEach(ctx => {
        if (ctx.state !== "running") { ctx.resume(); }
    });
}

function suspendAudio() {
    audioContextList.forEach(ctx => {
        if (ctx.state !== "suspended") { ctx.suspend(); }
    });
}

// ["click", "contextmenu", "auxclick", "dblclick"
//     , "mousedown", "mouseup", "pointerup", "touchend"
//     , "keydown", "keyup"
// ].forEach(name => document.addEventListener(name, resumeAudio));

//--------------------- emscripten ----------------------------
var Module = {
    preRun: []
    , postRun: []
    , print: function (e) {
        1 < arguments.length && (e = Array.prototype.slice.call(arguments).join(" "));
        console.log(e);
    }
    , printErr: function (e) {
        1 < arguments.length && (e = Array.prototype.slice.call(arguments).join(" "));
        console.error(e)
    }
    , pd: {} // make pd object accessible from outside of the scope
    , mainInit: function () { // called after Module is ready
        Module.pd = new Module.Pd(); // instantiate Pd object
        if (typeof Module.pd != "object") {
            alert("Pd: failed to instantiate pd object");
            console.error("Pd: failed to instantiate pd object");
            Module.mainExit();
            return;
        }
        var pd = Module.pd;
        pd.setNoGui(true); // set to true if you don't use the pd's gui

        // create an AudioContext
        var isWebAudioSupported = false;
        var audioContextList = [];
        (function () {
            var AudioContext = self.AudioContext || self.webkitAudioContext || false;
            if (AudioContext) {
                isWebAudioSupported = true;
                self.AudioContext = new Proxy(AudioContext, {
                    construct(target, args) {
                        var result = new target(...args);
                        audioContextList.push(result);
                        return result;
                    }
                });
            }
        })();
        if (isWebAudioSupported) {
            console.log("Audio: successfully enabled");
        }
        else {
            alert("The Web Audio API is not supported in this browser.");
            console.error("Audio: failed to use the web audio");
            Module.mainExit();
            return;
        }

        // check if the web midi library exists and is supported
        var isWebMidiSupported = false;
        if (typeof WebMidi != "object") {
            alert("Midi: failed to find the 'WebMidi' object");
            console.error("Midi: failed to find the 'WebMidi' object");
            Module.mainExit();
            return;
        }

        // array of enabled midi device ids (without duplicates)
        var midiInIds = [];
        var midiOutIds = [];

        // 10 input, 10 output device numbers to send with "pd midi-dialog"
        // 0: no device, 1: first available device, 2: second available device...
        var midiarr = [];

        // enable midi
        WebMidi.enable(function (err) {
            if (err) {
                // if the browser doesn't support web midi, one can still use pd without it
                // alert("The Web MIDI API is not supported in this browser.\nPlease check: https://github.com/djipco/webmidi#browser-support");
                console.error("Midi: failed to enable midi", err);
            }
            else {
                isWebMidiSupported = true;
                console.log("Midi: successfully enabled");

                // select all available input/output devices as default
                midiInIds = [];
                midiOutIds = [];
                for (var i = 0; i < WebMidi.inputs.length; i++) {
                    midiInIds.push(WebMidi.inputs[i].id);
                }
                for (var i = 0; i < WebMidi.outputs.length; i++) {
                    midiOutIds.push(WebMidi.outputs[i].id);
                }
                midiarr = [];
                for (var i = 0; i < 10; i++) {
                    var devno = i < midiInIds.length ? i + 1 : 0;
                    midiarr.push(devno);
                }
                for (var i = 0; i < 10; i++) {
                    var devno = i < midiOutIds.length ? i + 1 : 0;
                    midiarr.push(devno);
                }
                // called whenever input/output devices connection status changes
                function onConnectionChanged() {
                    console.log("Midi: connection status changed");
                    pdsend("pd midi-dialog", midiarr.join(" ")); // send message to pd
                }
                // make sure we get only one callback at a time
                var timerId;
                WebMidi.addListener("connected", function (e) {
                    clearTimeout(timerId);
                    timerId = setTimeout(() => onConnectionChanged(), 100);
                });
                WebMidi.addListener("disconnected", function (e) {
                    clearTimeout(timerId);
                    timerId = setTimeout(() => onConnectionChanged(), 100);
                });
            }
        }, false); // not use sysex

        // reinit pd (called by "pd audio-dialog" message)
        Module.Pd.reinit = function (newinchan, newoutchan, newrate) {
            if (pd.init(newinchan, newoutchan, newrate, pd.getTicksPerBuffer())) {

                // print obtained settings
                console.log("Pd: successfully reinitialized");
                console.log("Pd: audio input channels: " + pd.getNumInChannels());
                console.log("Pd: audio output channels: " + pd.getNumOutChannels());
                console.log("Pd: audio sample rate: " + pd.getSampleRate());
                console.log("Pd: audio ticks per buffer: " + pd.getTicksPerBuffer());
            }
            else {
                // failed to reinit pd
                alert("Pd: failed to reinitialize pd");
                console.error("Pd: failed to reinitialize pd");
                Module.mainExit();
            }
        }

        // open midi (called by "pd midi-dialog" message)
        // receives input/output arrays of only selected devices
        // 0: first available device, 1: second available device...
        Module.Pd.openMidi = function (midiinarr, midioutarr) {
            if (!isWebMidiSupported)
                return;

            // if the selected device doesn't exist, use first available device instead
            midiinarr = midiinarr.map(item => item >= WebMidi.inputs.length || item < 0 ? 0 : item);
            midioutarr = midioutarr.map(item => item >= WebMidi.outputs.length || item < 0 ? 0 : item);

            // save this settings so we can check again later when connection status changes 
            midiarr = [];
            for (var i = 0; i < 10; i++) {
                var devno = i < midiinarr.length ? midiinarr[i] + 1 : 0;
                midiarr.push(devno);
            }
            for (var i = 0; i < 10; i++) {
                var devno = i < midioutarr.length ? midioutarr[i] + 1 : 0;
                midiarr.push(devno);
            }
            // remove duplicates and convert device numbers to ids
            midiinarr = Array.from(new Set(midiinarr));
            midioutarr = Array.from(new Set(midioutarr));
            midiInIds = midiinarr.map(item => WebMidi.inputs[item].id);
            midiOutIds = midioutarr.map(item => WebMidi.outputs[item].id);

            // print all selected devices to the console
            for (var i = 0; i < midiInIds.length; i++) {
                var input = WebMidi.getInputById(midiInIds[i]);
                console.log("Midi: input" + (i + 1) + ": " + input.name);
            }
            for (var i = 0; i < midiOutIds.length; i++) {
                var output = WebMidi.getOutputById(midiOutIds[i]);
                console.log("Midi: output" + (i + 1) + ": " + output.name);
            }
            // receive midi messages from WebMidi and forward them to pd input
            function receiveNoteOn(e) {
                pd.sendNoteOn(e.channel, e.note.number, e.rawVelocity);
            }

            function receiveNoteOff(e) {
                pd.sendNoteOn(e.channel, e.note.number, 0);
            }

            function receiveControlChange(e) {
                pd.sendControlChange(e.channel, e.controller.number, e.value);
            }

            function receiveProgramChange(e) {
                pd.sendProgramChange(e.channel, e.value + 1);
            }

            function receivePitchBend(e) {
                // [bendin] takes 0 - 16383 while [bendout] returns -8192 - 8192
                pd.sendPitchBend(e.channel, e.value * 8192 + 8192);
            }

            function receiveAftertouch(e) {
                pd.sendAftertouch(e.channel, e.value * 127);
            }

            function receivePolyAftertouch(e) {
                pd.sendPolyAftertouch(e.channel, e.note.number, e.value * 127);
            }

            for (var i = 0; i < midiInIds.length; i++) {
                var input = WebMidi.getInputById(midiInIds[i]);
                if (input) {
                    input.removeListener(); // remove all added listeners
                    input.addListener("noteon", "all", receiveNoteOn);
                    input.addListener("noteoff", "all", receiveNoteOff);
                    input.addListener("controlchange", "all", receiveControlChange);
                    input.addListener("programchange", "all", receiveProgramChange);
                    input.addListener("pitchbend", "all", receivePitchBend);
                    input.addListener("channelaftertouch", "all", receiveAftertouch);
                    input.addListener("keyaftertouch", "all", receivePolyAftertouch);
                }
            }
        }

        // get midi in device name
        Module.Pd.getMidiInDeviceName = function (devno) {
            if (!isWebMidiSupported)
                return;
            if (devno >= WebMidi.inputs.length || devno < 0) {
                devno = 0;
            }
            var name = WebMidi.inputs[devno].name;
            var lengthBytes = lengthBytesUTF8(name) + 1;
            var stringOnWasmHeap = _malloc(lengthBytes);
            stringToUTF8(name, stringOnWasmHeap, lengthBytes);
            return stringOnWasmHeap;
        }

        // get midi out device name
        Module.Pd.getMidiOutDeviceName = function (devno) {
            if (!isWebMidiSupported)
                return;
            if (devno >= WebMidi.inputs.length || devno < 0) {
                devno = 0;
            }
            var name = WebMidi.outputs[devno].name;
            var lengthBytes = lengthBytesUTF8(name) + 1;
            var stringOnWasmHeap = _malloc(lengthBytes);
            stringToUTF8(name, stringOnWasmHeap, lengthBytes);
            return stringOnWasmHeap;
        }

        // receive gui commands (only called in gui mode)
        Module.Pd.receiveCommandBuffer = function (data) {
            var command_buffer = {
                next_command: ""
            };
            perfect_parser(data, command_buffer);
        }

        // receive print messages (only called in no gui mode)
        Module.Pd.receivePrint = function (s) {
            console.log(s);
        }

        // receive from pd's subscribed sources
        Module.Pd.receiveBang = function (source) {
            if (source in subscribedData) {
                for (const data of subscribedData[source]) {
                    switch (data.type) {
                        case "bng":
                            gui_bng_update_circle(data);
                            break;
                        case "tgl":
                            data.value = data.value ? 0 : data.default_value;
                            gui_tgl_update_cross(data);
                            break;
                    }
                }
            }
        }

        Module.Pd.receiveFloat = function (source, value) {
            if (source in subscribedData) {
                for (const data of subscribedData[source]) {
                    switch (data.type) {
                        case "bng":
                            gui_bng_update_circle(data);
                            break;
                        case "tgl":
                            data.value = value;
                            gui_tgl_update_cross(data);
                            break;
                    }
                }
            }
        }

        Module.Pd.receiveSymbol = function (source, symbol) {
            if (source in subscribedData) {
                for (const data of subscribedData[source]) {
                    switch (data.type) {
                        case "bng":
                            gui_bng_update_circle(data);
                            break;
                    }
                }
            }
        }

        Module.Pd.receiveList = function (source, list) {
            if (source in subscribedData) {
                for (const data of subscribedData[source]) {
                    switch (data.type) {
                        case "bng":
                            gui_bng_update_circle(data);
                            break;
                        case "tgl":
                            data.value = list[0];
                            gui_tgl_update_cross(data);
                            break;
                    }
                }
            }
        }

        Module.Pd.receiveMessage = function (source, symbol, list) {
            if (source in subscribedData) {
                for (const data of subscribedData[source]) {
                    switch (data.type) {
                        case "bng":
                            switch (symbol) {
                                case "size":
                                    data.size = list[0] || 8;
                                    configure_item(data.rect, gui_bng_rect(data));
                                    configure_item(data.circle, gui_bng_circle(data));
                                    break;
                                case "flashtime":
                                    data.interrupt = list[0] || 10;
                                    data.hold = list[1] || 50;
                                    break;
                                case "init":
                                    data.init = list[0];
                                    break;
                                case "send":
                                    data.send = list[0];
                                    break;
                                case "receive":
                                    gui_unsubscribe(data);
                                    data.receive = list[0];
                                    gui_subscribe(data);
                                    break;
                                case "label":
                                    data.label = list[0] === "empty" ? "" : list[0];
                                    data.text.textContent = data.label;
                                    break;
                                case "label_pos":
                                    data.x_off = list[0];
                                    data.y_off = list[1] || 0;
                                    configure_item(data.text, gui_bng_text(data));
                                    break;
                                case "label_font":
                                    data.font = list[0];
                                    data.fontsize = list[1] || 0;
                                    configure_item(data.text, gui_bng_text(data));
                                    break;
                                case "color":
                                    data.bg_color = list[0];
                                    data.fg_color = list[1] || 0;
                                    data.label_color = list[2] || 0;
                                    configure_item(data.rect, gui_bng_rect(data));
                                    configure_item(data.text, gui_bng_text(data));
                                    break;
                                case "pos":
                                    data.x_pos = list[0];
                                    data.y_pos = list[1] || 0;
                                    configure_item(data.rect, gui_bng_rect(data));
                                    configure_item(data.circle, gui_bng_circle(data));
                                    configure_item(data.text, gui_bng_text(data));
                                    break;
                                case "delta":
                                    data.x_pos += list[0];
                                    data.y_pos += list[1] || 0;
                                    configure_item(data.rect, gui_bng_rect(data));
                                    configure_item(data.circle, gui_bng_circle(data));
                                    configure_item(data.text, gui_bng_text(data));
                                    break;
                                default:
                                    gui_bng_update_circle(data);
                            }
                            break;
                        case "tgl":
                            switch (symbol) {
                                case "size":
                                    data.size = list[0] || 8;
                                    configure_item(data.rect, gui_tgl_rect(data));
                                    configure_item(data.cross1, gui_tgl_cross1(data));
                                    configure_item(data.cross2, gui_tgl_cross2(data));
                                    break;
                                case "nonzero":
                                    data.default_value = list[0];
                                    break;
                                case "init":
                                    data.init = list[0];
                                    break;
                                case "send":
                                    data.send = list[0];
                                    break;
                                case "receive":
                                    gui_unsubscribe(data);
                                    data.receive = list[0];
                                    gui_subscribe(data);
                                    break;
                                case "label":
                                    data.label = list[0] === "empty" ? "" : list[0];
                                    data.text.textContent = data.label;
                                    break;
                                case "label_pos":
                                    data.x_off = list[0];
                                    data.y_off = list[1] || 0;
                                    configure_item(data.text, gui_tgl_text(data));
                                    break;
                                case "label_font":
                                    data.font = list[0];
                                    data.fontsize = list[1] || 0;
                                    configure_item(data.text, gui_tgl_text(data));
                                    break;
                                case "color":
                                    data.bg_color = list[0];
                                    data.fg_color = list[1] || 0;
                                    data.label_color = list[2] || 0;
                                    configure_item(data.rect, gui_tgl_rect(data));
                                    configure_item(data.cross1, gui_tgl_cross1(data));
                                    configure_item(data.cross2, gui_tgl_cross2(data));
                                    configure_item(data.text, gui_tgl_text(data));
                                    break;
                                case "pos":
                                    data.x_pos = list[0];
                                    data.y_pos = list[1] || 0;
                                    configure_item(data.rect, gui_tgl_rect(data));
                                    configure_item(data.cross1, gui_tgl_cross1(data));
                                    configure_item(data.cross2, gui_tgl_cross2(data));
                                    configure_item(data.text, gui_tgl_text(data));
                                    break;
                                case "delta":
                                    data.x_pos += list[0];
                                    data.y_pos += list[1] || 0;
                                    configure_item(data.rect, gui_tgl_rect(data));
                                    configure_item(data.cross1, gui_tgl_cross1(data));
                                    configure_item(data.cross2, gui_tgl_cross2(data));
                                    configure_item(data.text, gui_tgl_text(data));
                                    break;
                                case "set":
                                    data.default_value = list[0];
                                    data.value = data.default_value;
                                    gui_tgl_update_cross(data);
                                    break;
                            }
                            break;
                        case "cnv":
                            switch (symbol) {
                                case "size":
                                    data.size = list[0] || 1;
                                    configure_item(data.selectable_rect, gui_cnv_selectable_rect(data));
                                    break;
                                case "vis_size":
                                    if (list.length === 1) {
                                        data.width = list[0] || 1;
                                        data.height = data.width;
                                    }
                                    else {
                                        data.width = list[0] || 1;
                                        data.height = list[1] || 1;
                                    }
                                    configure_item(data.visible_rect, gui_cnv_visible_rect(data));
                                    break;
                                case "send":
                                    data.send = list[0];
                                    break;
                                case "receive":
                                    gui_unsubscribe(data);
                                    data.receive = list[0];
                                    gui_subscribe(data);
                                    break;
                                case "label":
                                    data.label = list[0] === "empty" ? "" : list[0];
                                    data.text.textContent = data.label;
                                    break;
                                case "label_pos":
                                    data.x_off = list[0];
                                    data.y_off = list[1] || 0;
                                    configure_item(data.text, gui_cnv_text(data));
                                    break;
                                case "label_font":
                                    data.font = list[0];
                                    data.fontsize = list[1] || 0;
                                    configure_item(data.text, gui_cnv_text(data));
                                    break;
                                case "get_pos":
                                    break;
                                case "color":
                                    data.bg_color = list[0];
                                    data.label_color = list[1] || 0;
                                    configure_item(data.visible_rect, gui_cnv_visible_rect(data));
                                    configure_item(data.selectable_rect, gui_cnv_selectable_rect(data));
                                    configure_item(data.text, gui_cnv_text(data));
                                    break;
                                case "pos":
                                    data.x_pos = list[0];
                                    data.y_pos = list[1] || 0;
                                    configure_item(data.visible_rect, gui_cnv_visible_rect(data));
                                    configure_item(data.selectable_rect, gui_cnv_selectable_rect(data));
                                    configure_item(data.text, gui_cnv_text(data));
                                    break;
                                case "delta":
                                    data.x_pos += list[0];
                                    data.y_pos += list[1] || 0;
                                    configure_item(data.visible_rect, gui_cnv_visible_rect(data));
                                    configure_item(data.selectable_rect, gui_cnv_selectable_rect(data));
                                    configure_item(data.text, gui_cnv_text(data));
                                    break;
                            }
                            break;
                    }
                }
            }
        }

        // receive midi messages from pd and forward them to WebMidi output
        Module.Pd.receiveNoteOn = function (channel, pitch, velocity) {
            for (var i = 0; i < midiOutIds.length; i++) {
                var output = WebMidi.getOutputById(midiOutIds[i]);
                if (output) {
                    output.playNote(pitch, channel, { rawVelocity: true, velocity: velocity });
                }
            }
        }

        Module.Pd.receiveControlChange = function (channel, controller, value) {
            for (var i = 0; i < midiOutIds.length; i++) {
                var output = WebMidi.getOutputById(midiOutIds[i]);
                if (output) {
                    output.sendControlChange(controller, value, channel);
                }
            }
        }

        Module.Pd.receiveProgramChange = function (channel, value) {
            for (var i = 0; i < midiOutIds.length; i++) {
                var output = WebMidi.getOutputById(midiOutIds[i]);
                if (output) {
                    output.sendProgramChange(value, channel);
                }
            }
        }

        Module.Pd.receivePitchBend = function (channel, value) {
            for (var i = 0; i < midiOutIds.length; i++) {
                var output = WebMidi.getOutputById(midiOutIds[i]);
                if (output) {
                    // [bendin] takes 0 - 16383 while [bendout] returns -8192 - 8192
                    output.sendPitchBend(value / 8192, channel);
                }
            }
        }

        Module.Pd.receiveAftertouch = function (channel, value) {
            for (var i = 0; i < midiOutIds.length; i++) {
                var output = WebMidi.getOutputById(midiOutIds[i]);
                if (output) {
                    output.sendChannelAftertouch(value / 127, channel);
                }
            }
        }

        Module.Pd.receivePolyAftertouch = function (channel, pitch, value) {
            for (var i = 0; i < midiOutIds.length; i++) {
                var output = WebMidi.getOutputById(midiOutIds[i]);
                if (output) {
                    output.sendKeyAftertouch(pitch, channel, value / 127);
                }
            }
        }

        Module.Pd.receiveMidiByte = function (port, byte) {
        }

        // default audio settings
        var numInChannels = 0; // supported values: 0, 1, 2
        var numOutChannels = 2; // supported values: 1, 2
        var sampleRate = 44100; // might change depending on browser/system
        var ticksPerBuffer = 32; // supported values: 4, 8, 16, 32, 64, 128, 256

        // open audio devices, init pd
        if (pd.init(numInChannels, numOutChannels, sampleRate, ticksPerBuffer)) {

            // print obtained settings
            console.log("Pd: successfully initialized");
            console.log("Pd: audio input channels:", pd.getNumInChannels());
            console.log("Pd: audio output channels:", pd.getNumOutChannels());
            console.log("Pd: audio sample rate:", pd.getSampleRate());
            console.log("Pd: audio ticks per buffer:", pd.getTicksPerBuffer());

            // add internals/externals help/search paths
            var helpPath = "purr-data/doc/5.reference";
            var extPath = "purr-data/extra";
            pd.addToHelpPath(helpPath);
            pd.addToSearchPath(extPath);
            pd.addToHelpPath(extPath);
            var dir = FS.readdir(extPath);
            for (var i = 0; i < dir.length; i++) {
                var item = dir[i];
                if (item.charAt(0) != ".") {
                    var path = extPath + "/" + item;
                    pd.addToSearchPath(path); // externals can be created without path prefix
                    pd.addToHelpPath(path);
                }
            }
            init(); // call global init function
        }
        else { // failed to init pd
            alert("Pd: failed to initialize pd");
            console.error("Pd: failed to initialize pd");
            Module.mainExit();
        }
    }
    , mainLoop: function () { // called every frame (use for whatever)
    }
    , mainExit: function () { // this won't be called from emscripten
        console.error("quiting emscripten...");
        if (typeof Module.pd == "object") {
            Module.pd.clear(); // clear pd, close audio devices
            Module.pd.unsubscribeAll(); // unsubscribe all subscribed sources
            Module.pd.delete(); // quit SDL, emscripten
        }
        if (typeof WebMidi == "object") {
            WebMidi.disable(); // disable all midi devices
        }
    }
};

//--------------------- pdgui.js ----------------------------

function pdsend() {
    var string = Array.prototype.join.call(arguments, " ");
    var array = string.split(" ");
    Module.pd.startMessage(array.length - 2);
    for (let i = 2; i < array.length; i++) {
        if (isNaN(array[i]) || array[i] === "") {
            Module.pd.addSymbol(array[i]);
        }
        else {
            Module.pd.addFloat(parseFloat(array[i]));
        }
    }
    Module.pd.finishMessage(array[0], array[1]);
}

function gui_ping() {
    pdsend("pd ping");
}

function gui_post(string, type) {
    console.log("gui_post", string, type);
}

function gui_post_error(objectid, loglevel, error_msg) {
    console.log("gui_post_error", objectid, loglevel, error_msg);
}

function gui_print(object_id, selector, array_of_strings) {
    console.log("gui_print", object_id, selector, array_of_strings);
}

function gui_legacy_tcl_command(file, line_number, text) {
    console.log("gui_legacy_tcl_command", file, line_number, text);
}

function gui_load_default_image(dummy_cid, key) {
    console.log("gui_load_default_image", dummy_cid, key);
}

function gui_undo_menu(cid, undo_text, redo_text) {
    console.log("gui_undo_menu", cid, undo_text, redo_text);
}

function gui_startup(version, fontname_from_pd, fontweight_from_pd, apilist, midiapilist) {
    console.log("gui_startup", version, fontname_from_pd, fontweight_from_pd, apilist, midiapilist);
}

function gui_set_cwd(dummy, cwd) {
    console.log("gui_set_cwd", dummy, cwd);
}

function set_audioapi(val) {
    console.log("set_audioapi", val);
}

function gui_pd_dsp(state) {
    console.log("gui_pd_dsp", state);
}

function gui_canvas_new(cid, width, height, geometry, zoom, editmode, name, dir, dirty_flag, hide_scroll, hide_menu, cargs) {
    console.log("gui_canvas_new", cid, width, height, geometry, zoom, editmode, name, dir, dirty_flag, hide_scroll, hide_menu, cargs);
}

function gui_set_toplevel_window_list(dummy, attr_array) {
    console.log("gui_pd_dsp", dummy, attr_array);
}

function gui_window_close(cid) {
    console.log("gui_window_close", cid);
}

function gui_canvas_get_scroll(cid) {
    console.log("gui_canvas_get_scroll", cid);
}

function pd_receive_command_buffer(data) {
    var command_buffer = {
        next_command: ""
    };
    perfect_parser(data, command_buffer);
}

function perfect_parser(data, cbuf, sel_array) {
    var i, len, selector, args;
    len = data.length;
    for (i = 0; i < len; i++) {
        // check for end of command:
        if (data[i] === 31) { // unit separator
            // decode next_command
            try {
                // This should work for all utf-8 content
                cbuf.next_command =
                    decodeURIComponent(cbuf.next_command);
            }
            catch (err) {
                // This should work for ISO-8859-1
                cbuf.next_command = unescape(cbuf.next_command);
            }
            // Turn newlines into backslash + "n" so
            // eval will do the right thing with them
            cbuf.next_command = cbuf.next_command.replace(/\n/g, "\\n");
            cbuf.next_command = cbuf.next_command.replace(/\r/g, "\\r");
            selector = cbuf.next_command.slice(0, cbuf.next_command.indexOf(" "));
            args = cbuf.next_command.slice(selector.length + 1);
            cbuf.next_command = "";
            // Now evaluate it
            //post("Evaling: " + selector + "(" + args + ");");
            // For communicating with a secondary instance, we filter
            // incoming messages. A better approach would be to make
            // sure that the Pd engine only sends the gui_set_cwd message
            // before "gui_startup".  Then we could just check the
            // Pd engine id in "gui_startup" and branch there, instead of
            // fudging with the parser here.
            if (!sel_array || sel_array.indexOf(selector) !== -1) {
                eval(selector + "(" + args + ");");
            }
        } else {
            cbuf.next_command += "%" +
                ("0" // leading zero (for rare case of single digit)
                    + data[i].toString(16)) // to hex
                    .slice(-2); // remove extra leading zero
        }
    }
}

function gui_audio_properties(gfxstub, sys_indevs, sys_outdevs,
    pd_indevs, pd_inchans, pd_outdevs, pd_outchans, audio_attrs) {
    console.log("gui_audio_properties", gfxstub, sys_indevs, sys_outdevs,
        pd_indevs, pd_inchans, pd_outdevs, pd_outchans, audio_attrs);
}

function gui_midi_properties(gfxstub, sys_indevs, sys_outdevs,
    pd_indevs, pd_outdevs, midi_attrs) {
    console.log("gui_midi_properties", gfxstub, sys_indevs, sys_outdevs,
        pd_indevs, pd_outdevs, midi_attrs);
}

function set_midiapi(val) {
    console.log("set_midiapi", val);
}

//--------------------- gui handling ----------------------------
function create_item(type, args) {
    var item = document.createElementNS("http://www.w3.org/2000/svg", type);
    if (args !== null) {
        configure_item(item, args);
    }
    canvas.appendChild(item);
    return item;
}

function configure_item(item, attributes) {
    // draw_vis from g_template sends attributes
    // as a ["attr1",val1, "attr2", val2, etc.] array,
    // so we check for that here
    var value, i, attr;
    if (Array.isArray(attributes)) {
        // we should check to make sure length is even here...
        for (i = 0; i < attributes.length; i += 2) {
            value = attributes[i + 1];
            item.setAttributeNS(null, attributes[i],
                Array.isArray(value) ? value.join(" ") : value);
        }
    } else {
        for (attr in attributes) {
            if (attributes.hasOwnProperty(attr)) {
                if (item) {
                    item.setAttributeNS(null, attr, attributes[attr]);
                }
            }
        }
    }
}

function iemgui_fontfamily(font) {
    let family = "";
    if (font === 1) {
        family = "'Helvetica', 'DejaVu Sans', 'sans-serif'";
    }
    else if (font === 2) {
        family = "'Times New Roman', 'DejaVu Serif', 'FreeSerif', 'serif'";
    }
    else {
        family = "'DejaVu Sans Mono', 'monospace'";
    }
    return family;
}

function colfromload(col) { // decimal to hex color
    col = -1 - col;
    col = ((col & 0x3f000) << 6) | ((col & 0xfc0) << 4) | ((col & 0x3f) << 2);
    return "#" + ("000000" + col.toString(16)).slice(-6);
}

function gui_subscribe(data) {
    if (data.receive in subscribedData) {
        subscribedData[data.receive].push(data);
    }
    else {
        subscribedData[data.receive] = [data];
    }
    Module.pd.subscribe(data.receive);
}

function gui_unsubscribe(data) {
    if (data.receive in subscribedData) {
        const len = subscribedData[data.receive].length;
        for (let i = 0; i < len; i++) {
            if (subscribedData[data.receive][i].id === data.id) {
                Module.pd.unsubscribe(data.receive);
                subscribedData[data.receive].splice(i, 1);
                if (!subscribedData[data.receive].length) {
                    delete subscribedData[data.receive];
                }
                break;
            }
        }
    }
}

// common
function gui_rect(data) {
    return {
        x: data.x_pos,
        y: data.y_pos,
        width: data.size,
        height: data.size,
        fill: colfromload(data.bg_color),
        id: `${data.id}_rect`,
        class: "border clickable"
    }
}

function gui_text(data) {
    return {
        x: data.x_pos + data.x_off,
        y: data.y_pos + data.y_off,
        "font-family": iemgui_fontfamily(data.font),
        "font-weight": "normal",
        "font-size": `${data.fontsize}px`,
        fill: colfromload(data.label_color),
        transform: `translate(0, ${data.fontsize / 2 * 0.6})`, // note: modified
        id: `${data.id}_text`,
        class: "unclickable"
    }
}

// bng
function gui_bng_rect(data) {
    return gui_rect(data);
}

function gui_bng_circle(data) {
    const r = (data.size - 2) / 2;
    const cx = data.x_pos + r + 1;
    const cy = data.y_pos + r + 1;
    return {
        cx: cx,
        cy: cy,
        r: r,
        fill: "none",
        id: `${data.id}_circle`,
        class: "border unclickable"
    }
}

function gui_bng_text(data) {
    return gui_text(data);
}

function gui_bng_update_circle(data) {
    if (data.flashed) {
        data.flashed = false;
        configure_item(data.circle, {
            fill: colfromload(data.fg_color),
        });
        if (data.interrupt_timer) {
            clearTimeout(data.interrupt_timer);
        }
        data.interrupt_timer = setTimeout(function () {
            data.interrupt_timer = null;
            configure_item(data.circle, {
                fill: "none",
            });
        }, data.interrupt);
        data.flashed = true;
    }
    else {
        data.flashed = true;
        configure_item(data.circle, {
            fill: colfromload(data.fg_color),
        });
    }
    if (data.hold_timer) {
        clearTimeout(data.hold_timer);
    }
    data.hold_timer = setTimeout(function () {
        data.flashed = false;
        data.hold_timer = null;
        configure_item(data.circle, {
            fill: "none",
        });
    }, data.hold);
}

function gui_bng_onmousedown(data) {
    gui_bng_update_circle(data);
    Module.pd.sendBang(data.send);
}

// tgl
function gui_tgl_rect(data) {
    return gui_rect(data);
}

function gui_tgl_cross1(data) {
    const w = (data.size + 29) / 30 * 0.75; // note: modified
    const x1 = data.x_pos;
    const y1 = data.y_pos;
    const x2 = x1 + data.size;
    const y2 = y1 + data.size;
    const p1 = x1 + w + 1;
    const p2 = y1 + w + 1;
    const p3 = x2 - w - 1;
    const p4 = y2 - w - 1;
    const points = [p1, p2, p3, p4].join(" ");
    return {
        points: points,
        stroke: colfromload(data.fg_color),
        "stroke-width": w,
        fill: "none",
        display: data.value ? "inline" : "none",
        id: `${data.id}_cross1`,
        class: "unclickable"
    }
}

function gui_tgl_cross2(data) {
    const w = (data.size + 29) / 30 * 0.75; // note: modified
    const x1 = data.x_pos;
    const y1 = data.y_pos;
    const x2 = x1 + data.size;
    const y2 = y1 + data.size;
    const p1 = x1 + w + 1;
    const p2 = y2 - w - 1;
    const p3 = x2 - w - 1;
    const p4 = y1 + w + 1;
    const points = [p1, p2, p3, p4].join(" ");
    return {
        points: points,
        stroke: colfromload(data.fg_color),
        "stroke-width": w,
        fill: "none",
        display: data.value ? "inline" : "none",
        id: `${data.id}_cross2`,
        class: "unclickable"
    }
}

function gui_tgl_text(data) {
    return gui_text(data);
}

function gui_tgl_update_cross(data) {
    configure_item(data.cross1, {
        display: data.value ? "inline" : "none",
    });
    configure_item(data.cross2, {
        display: data.value ? "inline" : "none",
    });
}

function gui_tgl_onmousedown(data) {
    data.value = data.value ? 0 : data.default_value;
    gui_tgl_update_cross(data);
    Module.pd.sendFloat(data.send, data.value);
}

// cnv
function gui_cnv_visible_rect(data) {
    return {
        x: data.x_pos,
        y: data.y_pos,
        width: data.width,
        height: data.height,
        fill: colfromload(data.bg_color),
        stroke: colfromload(data.bg_color),
        id: `${data.id}_visible_rect`,
        class: "unclickable"
    }
}

function gui_cnv_selectable_rect(data) {
    return {
        x: data.x_pos,
        y: data.y_pos,
        width: data.size,
        height: data.size,
        fill: "none",
        stroke: colfromload(data.bg_color),
        id: `${data.id}_selectable_rect`,
        class: "unclickable"
    }
}

function gui_cnv_text(data) {
    return gui_text(data);
}

// text
function gobj_font_y_kludge(fontsize) {
    switch (fontsize) {
        case 8: return -0.5;
        case 10: return -1;
        case 12: return -1;
        case 16: return -1.5;
        case 24: return -3;
        case 36: return -6;
        default: return 0;
    }
}

let font_engine_sanity = false;

function set_font_engine_sanity() {
    const canvas = document.createElement("canvas"),
        ctx = canvas.getContext("2d"),
        test_text = "struct theremin float x float y";
    canvas.id = "font_sanity_checker_canvas";
    document.body.appendChild(canvas);
    ctx.font = "11.65px DejaVu Sans Mono";
    if (Math.floor(ctx.measureText(test_text).width) <= 217) {
        font_engine_sanity = true;
    } else {
        font_engine_sanity = false;
    }
    canvas.parentNode.removeChild(canvas);
}
set_font_engine_sanity();

function font_stack_is_maintained_by_troglodytes() {
    return !font_engine_sanity;
}

function font_map() {
    return {
        // pd_size: gui_size
        8: 8.33,
        12: 11.65,
        16: 16.65,
        24: 23.3,
        36: 36.6
    };
}

function suboptimal_font_map() {
    return {
        // pd_size: gui_size
        8: 8.45,
        12: 11.4,
        16: 16.45,
        24: 23.3,
        36: 36
    }
}

function font_height_map() {
    return {
        // fontsize: fontheight 
        8: 11,
        10: 13,
        12: 16,
        16: 19,
        24: 29,
        36: 44
    };
}

function gobj_fontsize_kludge(fontsize, return_type) {
    // These were tested on an X60 running Trisquel (based
    // on Ubuntu 14.04)
    var ret, prop,
        fmap = font_stack_is_maintained_by_troglodytes() ?
            suboptimal_font_map() : font_map();
    if (return_type === "gui") {
        ret = fmap[fontsize];
        return ret ? ret : fontsize;
    } else {
        for (prop in fmap) {
            if (fmap.hasOwnProperty(prop)) {
                if (fmap[prop] == fontsize) {
                    return +prop;
                }
            }
        }
        return fontsize;
    }
}

function pd_fontsize_to_gui_fontsize(fontsize) {
    return gobj_fontsize_kludge(fontsize, "gui");
}

function gui_text_text(data, line_index) {
    const left_margin = 2;
    const fmap = font_height_map();
    const font_height = fmap[fontSize] * (line_index + 1) * 0.9; // note: modified
    return {
        transform: `translate(${left_margin - 0.5})`,
        x: data.x_pos,
        y: data.y_pos + font_height + gobj_font_y_kludge(fontSize),
        "shape-rendering": "crispEdges",
        "font-size": pd_fontsize_to_gui_fontsize(fontSize) * 0.9 + "px", // note: modified
        "font-weight": "normal",
        id: `${data.id}_text_${line_index}`,
        class: "unclickable"
    }
}

//--------------------- patch handling ----------------------------
function openPatch(content, filename) {
    console.log(`patch: ${filename}`);
    let maxNumInChannels = 0;
    let canvasLevel = 0; // 0: no canvas, 1: main canvas, 2~: subcanvases
    let id = 0; // gui id
    while (canvas.lastChild) { // clear svg
        canvas.removeChild(canvas.lastChild);
    }
    Module.pd.unsubscribeAll();
    for (const source in subscribedData) {
        delete subscribedData[source];
    }
    const lines = content.split(";\n");
    for (let line of lines) {
        line = line.replace(/[\r\n]+/g, " ").trim(); // remove newlines & carriage returns
        const args = line.split(" ");
        const type = args.slice(0, 2).join(" ");
        switch (type) {
            case "#N canvas":
                canvasLevel++;
                if (canvasLevel === 1 && args.length === 7) { // should be called only once
                    canvasWidth = parseInt(args[4]);
                    canvasHeight = parseInt(args[5]);
                    fontSize = parseInt(args[6]);
                    canvas.setAttributeNS(null, "viewBox", `0 0 ${canvasWidth} ${canvasHeight}`);
                    console.log(`canvas size: ${canvasWidth}x${canvasHeight}`);
                }
                break;
            case "#X restore":
                canvasLevel--;
                break;
            case "#X obj":
                if (args.length > 4) {
                    switch (args[4]) {
                        case "adc~":
                            if (!maxNumInChannels) {
                                maxNumInChannels = 1;
                            }
                            for (let i = 5; i < args.length; i++) {
                                if (!isNaN(args[i])) {
                                    const numInChannels = parseInt(args[i]);
                                    if (numInChannels > maxNumInChannels) {
                                        maxNumInChannels = numInChannels > 2 ? 2 : numInChannels;
                                    }
                                }
                            }
                            break;
                        case "bng":
                            if (canvasLevel === 1 && args.length === 19 && args[9] !== "empty" && args[10] !== "empty") {
                                const data = {};
                                data.x_pos = parseInt(args[2]);
                                data.y_pos = parseInt(args[3]);
                                data.type = args[4];
                                data.size = parseInt(args[5]);
                                data.hold = parseInt(args[6]);
                                data.interrupt = parseInt(args[7]);
                                data.init = parseInt(args[8]);
                                data.send = args[9];
                                data.receive = args[10];
                                data.label = args[11] === "empty" ? "" : args[11];
                                data.x_off = parseInt(args[12]);
                                data.y_off = parseInt(args[13]);
                                data.font = parseInt(args[14]);
                                data.fontsize = parseInt(args[15]);
                                data.bg_color = parseInt(args[16]);
                                data.fg_color = parseInt(args[17]);
                                data.label_color = parseInt(args[18]);
                                data.id = `${data.type}_${id++}`;

                                // create svg
                                data.rect = create_item("rect", gui_bng_rect(data));
                                data.circle = create_item("circle", gui_bng_circle(data));
                                data.text = create_item("text", gui_bng_text(data));
                                data.text.textContent = data.label;

                                // handle event
                                data.flashed = false;
                                data.interrupt_timer = null;
                                data.hold_timer = null;
                                if (isMobile) {
                                    data.rect.addEventListener("touchstart", function () {
                                        gui_bng_onmousedown(data);
                                    });
                                }
                                else {
                                    data.rect.addEventListener("mousedown", function () {
                                        gui_bng_onmousedown(data);
                                    });
                                }
                                // subscribe receiver
                                gui_subscribe(data);
                            }
                            break;
                        case "tgl":
                            if (canvasLevel === 1 && args.length === 19 && args[7] !== "empty" && args[8] !== "empty") {
                                const data = {};
                                data.x_pos = parseInt(args[2]);
                                data.y_pos = parseInt(args[3]);
                                data.type = args[4];
                                data.size = parseInt(args[5]);
                                data.init = parseInt(args[6]);
                                data.send = args[7];
                                data.receive = args[8];
                                data.label = args[9] === "empty" ? "" : args[9];
                                data.x_off = parseInt(args[10]);
                                data.y_off = parseInt(args[11]);
                                data.font = parseInt(args[12]);
                                data.fontsize = parseInt(args[13]);
                                data.bg_color = parseInt(args[14]);
                                data.fg_color = parseInt(args[15]);
                                data.label_color = parseInt(args[16]);
                                data.init_value = parseFloat(args[17]);
                                data.default_value = parseFloat(args[18]);
                                data.value = data.init && data.init_value ? data.default_value : 0;
                                data.id = `${data.type}_${id++}`;

                                // create svg
                                data.rect = create_item("rect", gui_tgl_rect(data));
                                data.cross1 = create_item("polyline", gui_tgl_cross1(data));
                                data.cross2 = create_item("polyline", gui_tgl_cross2(data));
                                data.text = create_item("text", gui_tgl_text(data));
                                data.text.textContent = data.label;

                                // handle event
                                if (isMobile) {
                                    data.rect.addEventListener("touchstart", function () {
                                        gui_tgl_onmousedown(data);
                                    });
                                }
                                else {
                                    data.rect.addEventListener("mousedown", function () {
                                        gui_tgl_onmousedown(data);
                                    });
                                }
                                // subscribe receiver
                                gui_subscribe(data);
                            }
                            break;
                        case "cnv":
                            if (canvasLevel === 1 && args.length === 18 && args[8] !== "empty" && args[9] !== "empty") {
                                const data = {};
                                data.x_pos = parseInt(args[2]);
                                data.y_pos = parseInt(args[3]);
                                data.type = args[4];
                                data.size = parseInt(args[5]);
                                data.width = parseInt(args[6]);
                                data.height = parseInt(args[7]);
                                data.send = args[8];
                                data.receive = args[9];
                                data.label = args[10] === "empty" ? "" : args[10];
                                data.x_off = parseInt(args[11]);
                                data.y_off = parseInt(args[12]);
                                data.font = parseInt(args[13]);
                                data.fontsize = parseInt(args[14]);
                                data.bg_color = parseInt(args[15]);
                                data.label_color = parseInt(args[16]);
                                data.unknown = parseFloat(args[17]);
                                data.id = `${data.type}_${id++}`;

                                // create svg
                                data.visible_rect = create_item("rect", gui_cnv_visible_rect(data));
                                data.selectable_rect = create_item("rect", gui_cnv_selectable_rect(data));
                                data.text = create_item("text", gui_cnv_text(data));
                                data.text.textContent = data.label;

                                // subscribe receiver
                                gui_subscribe(data);
                            }
                            break;
                    }
                }
                break;
            case "#X text":
                if (args.length > 4) {
                    const data = {};
                    data.type = args[1];
                    data.x_pos = parseInt(args[2]);
                    data.y_pos = parseInt(args[3]);
                    data.comment = [];
                    const lines = args.slice(4).join(" ").replace(/ \\,/g, ",").replace(/\\; /g, ";\n").replace(/ ;/g, ";").split("\n");
                    for (const line of lines) {
                        const lines = line.match(/.{1,60}(\s|$)/g);
                        for (const line of lines) {
                            data.comment.push(line.trim());
                        }
                    }
                    data.id = `${data.type}_${id++}`;

                    // create svg
                    data.text = [];
                    for (let i = 0; i < data.comment.length; i++) {
                        const text = create_item("text", gui_text_text(data, i));
                        text.textContent = data.comment[i];
                        data.text.push(text);
                    }
                }
                break;
        }
    }
    if (!canvasLevel) {
        alert("The main canvas not found in the pd file.");
        return;
    }
    if (maxNumInChannels) {
        if (Module.pd.init(maxNumInChannels, Module.pd.getNumOutChannels(), Module.pd.getSampleRate(), Module.pd.getTicksPerBuffer())) {
            // print obtained settings
            console.log("Pd: successfully reinitialized");
            console.log("Pd: audio input channels: " + Module.pd.getNumInChannels());
            console.log("Pd: audio output channels: " + Module.pd.getNumOutChannels());
            console.log("Pd: audio sample rate: " + Module.pd.getSampleRate());
            console.log("Pd: audio ticks per buffer: " + Module.pd.getTicksPerBuffer());
        }
        else {
            // failed to reinit pd
            alert("Pd: failed to reinitialize pd");
            console.error("Pd: failed to reinitialize pd");
            Module.mainExit();
            return;
        }
    }
    const uint8Array = new TextEncoder().encode(content);
    FS.createDataFile("/", filename, uint8Array, true, true, true);
    currentFile = filename;
    Module.pd.openPatch(currentFile, "/");
    pdsend("pd dsp 1");
}

function uploadPatch(file) {
    if (file.name.split(".").pop() !== "pd" || file.name === "pd") {
        alert("Please upload a pd file.");
        return;
    }
    if (currentFile) {
        pdsend("pd dsp 0");
        Module.pd.closePatch(currentFile);
        FS.unlink("/" + currentFile);
    }
    const reader = new FileReader();
    reader.onload = function () {
        const uint8Array = new Uint8Array(reader.result);
        const content = new TextDecoder("utf-8").decode(uint8Array);
        openPatch(content, file.name);
    };
    reader.readAsArrayBuffer(file);
}

async function getPatchData(url) {
    const options = { method: "GET" };
    const res = await fetch(`/api/patch/?url=${url}`, options);
    const json = await res.json();
    return json;
}

// called after Module.mainInit() is called
async function init() {
    const urlParams = new URLSearchParams(window.location.search);
    const patchURL = urlParams.get("url");
    let content = "";
    let filename = "";
    if (patchURL) {
        filename = patchURL.split("/").pop();
        const patchData = await getPatchData(patchURL);
        if (patchData.error) {
            alert(`Failed to access the file from ${patchURL}`);
        }
        else {
            content = patchData.content;
        }
    }
    if (!content) {
        // load default patch content
        content = "#N canvas 50 50 300 500 10;\n#X obj 0 0 cnv 15 300 550 cnv-s cnv-r PdWebParty 80 24 0 24 -99865\n-262144 0;\n#N canvas 315 262 878 533 sound 0;\n#X obj 84 469 dac~;\n#X obj 85 321 osc~;\n#X obj 84 294 +~;\n#X obj 80 246 osc~;\n#X obj 82 271 *~;\n#X obj 167 246 mtof~;\n#X obj 79 224 mtof~;\n#X obj 167 224 sig~;\n#X obj 79 203 sig~;\n#X obj 168 204 + 40;\n#X obj 85 403 hip~ 40;\n#X obj 85 353 *~;\n#X obj 245 308 vline~;\n#X obj 320 243 + 50;\n#X obj 167 66 metro 125;\n#X obj 245 328 *~;\n#X obj 320 223 * 200;\n#X obj 245 265 pack f f;\n#X msg 245 287 \\$1 5 \\, 0 \\$2 5;\n#X obj 85 378 lop~ 2000;\n#X obj 245 244 + 0.5;\n#X obj 245 223 * 0.5;\n#X obj 167 106 sel 0;\n#X obj 167 86 random 4;\n#X obj 78 180 random 120;\n#X obj 168 180 random 120;\n#X obj 244 180 random 100;\n#X obj 320 179 random 100;\n#X obj 245 202 / 99;\n#X obj 320 200 / 99;\n#X obj 167 45 r toggle-s;\n#X obj 194 125 s button-r;\n#X obj 78 127 r button-s;\n#X obj 86 427 *~ 0.5;\n#N canvas 726 271 468 501 show 0;\n#X obj 52 132 random 100;\n#X obj 52 152 / 99;\n#X obj 52 328 + 5;\n#X msg 67 266 285 \\$1;\n#X obj 67 286 -;\n#X obj 52 308 *;\n#X obj 129 130 random 100;\n#X obj 129 150 / 99;\n#X obj 144 284 -;\n#X obj 129 306 *;\n#X obj 129 326 + 45;\n#X msg 144 264 405 \\$1;\n#X obj 66 182 random 100;\n#X obj 66 202 / 99;\n#X obj 66 242 + 15;\n#X obj 150 182 random 100;\n#X obj 150 202 / 99;\n#X obj 150 242 + 15;\n#X obj 53 354 pack f f;\n#X msg 54 374 pos \\$1 \\$2;\n#X obj 144 355 pack f f;\n#X msg 145 375 vis_size \\$1 \\$2;\n#X obj 245 212 * -65536;\n#X obj 308 212 * -256;\n#X obj 360 214 * -1;\n#X obj 295 312 +;\n#X obj 280 335 +;\n#X obj 280 357 - 1;\n#X msg 281 378 color \\$1 \\$1;\n#X obj 191 423 s;\n#X obj 166 74 t b b b b b b b s;\n#X obj 166 50 inlet;\n#X obj 228 164 + 128;\n#X obj 226 132 random 128;\n#X obj 298 132 random 128;\n#X obj 367 133 random 128;\n#X obj 302 165 + 128;\n#X obj 360 165 + 128;\n#X obj 66 222 * 185;\n#X obj 150 222 * 185;\n#X connect 0 0 1 0;\n#X connect 1 0 5 0;\n#X connect 2 0 18 0;\n#X connect 3 0 4 0;\n#X connect 4 0 5 1;\n#X connect 5 0 2 0;\n#X connect 6 0 7 0;\n#X connect 7 0 9 0;\n#X connect 8 0 9 1;\n#X connect 9 0 10 0;\n#X connect 10 0 18 1;\n#X connect 11 0 8 0;\n#X connect 12 0 13 0;\n#X connect 13 0 38 0;\n#X connect 14 0 3 0;\n#X connect 14 0 20 0;\n#X connect 15 0 16 0;\n#X connect 16 0 39 0;\n#X connect 17 0 11 0;\n#X connect 17 0 20 1;\n#X connect 18 0 19 0;\n#X connect 19 0 29 0;\n#X connect 20 0 21 0;\n#X connect 21 0 29 0;\n#X connect 22 0 26 0;\n#X connect 23 0 25 0;\n#X connect 24 0 25 1;\n#X connect 25 0 26 1;\n#X connect 26 0 27 0;\n#X connect 27 0 28 0;\n#X connect 28 0 29 0;\n#X connect 30 0 0 0;\n#X connect 30 1 12 0;\n#X connect 30 2 6 0;\n#X connect 30 3 15 0;\n#X connect 30 4 33 0;\n#X connect 30 5 34 0;\n#X connect 30 6 35 0;\n#X connect 30 7 29 1;\n#X connect 31 0 30 0;\n#X connect 32 0 22 0;\n#X connect 33 0 32 0;\n#X connect 34 0 36 0;\n#X connect 35 0 37 0;\n#X connect 36 0 23 0;\n#X connect 37 0 24 0;\n#X connect 38 0 14 0;\n#X connect 39 0 17 0;\n#X restore 430 248 pd show;\n#X msg 430 226 symbol show\\$1-r;\n#X msg 649 331 symbol show\\$1-r;\n#X obj 608 389 s;\n#X obj 567 213 t b f;\n#X obj 554 280 * -65536;\n#X obj 617 280 * -256;\n#X obj 669 282 * -1;\n#X obj 620 302 +;\n#X obj 605 325 +;\n#X obj 605 347 - 1;\n#X obj 569 254 unpack f f f;\n#X msg 567 233 220 220 220;\n#X msg 567 191 0 \\, 1 \\, 2 \\, 3 \\, 4 \\, 5 \\, 6 \\, 7;\n#X obj 567 169 loadbang;\n#X obj 78 149 t b b b b b, f 40;\n#X obj 430 178 random 4;\n#X msg 606 366 pos 70 310 \\, vis_size 15 15 \\, color 0 0;\n#X connect 1 0 11 0;\n#X connect 2 0 1 0;\n#X connect 3 0 4 0;\n#X connect 4 0 2 0;\n#X connect 5 0 4 1;\n#X connect 5 0 2 1;\n#X connect 6 0 3 0;\n#X connect 7 0 5 0;\n#X connect 8 0 6 0;\n#X connect 9 0 7 0;\n#X connect 10 0 33 0;\n#X connect 11 0 19 0;\n#X connect 12 0 15 0;\n#X connect 12 0 15 1;\n#X connect 13 0 17 1;\n#X connect 14 0 23 0;\n#X connect 15 0 11 1;\n#X connect 16 0 13 0;\n#X connect 17 0 18 0;\n#X connect 18 0 12 0;\n#X connect 19 0 10 0;\n#X connect 20 0 17 0;\n#X connect 21 0 20 0;\n#X connect 22 1 31 0;\n#X connect 23 0 22 0;\n#X connect 24 0 8 0;\n#X connect 25 0 9 0;\n#X connect 26 0 28 0;\n#X connect 27 0 29 0;\n#X connect 28 0 21 0;\n#X connect 29 0 16 0;\n#X connect 30 0 14 0;\n#X connect 32 0 49 0;\n#X connect 33 0 0 0;\n#X connect 33 0 0 1;\n#X connect 35 0 34 0;\n#X connect 36 0 37 1;\n#X connect 38 0 46 0;\n#X connect 38 1 36 0;\n#X connect 39 0 43 0;\n#X connect 40 0 42 0;\n#X connect 41 0 42 1;\n#X connect 42 0 43 1;\n#X connect 43 0 44 0;\n#X connect 44 0 51 0;\n#X connect 45 0 39 0;\n#X connect 45 1 40 0;\n#X connect 45 2 41 0;\n#X connect 46 0 45 0;\n#X connect 47 0 38 0;\n#X connect 48 0 47 0;\n#X connect 49 0 24 0;\n#X connect 49 1 25 0;\n#X connect 49 2 26 0;\n#X connect 49 3 27 0;\n#X connect 49 4 50 0;\n#X connect 50 0 35 0;\n#X connect 51 0 37 0;\n#X restore 4 513 pd sound;\n#X obj 5 45 cnv 15 290 450 cnv2-s cnv2-r empty 20 12 0 14 -228856 -66577\n0;\n#X obj 70 310 cnv 15 15 15 show0-s show0-r empty 20 12 0 14 -262144\n-66577 0;\n#X obj 70 310 cnv 15 15 15 show1-s show1-r empty 20 12 0 14 -262144\n-66577 0;\n#X obj 70 310 cnv 15 15 15 show2-s show2-r empty 20 12 0 14 -262144\n-66577 0;\n#X obj 70 310 cnv 15 15 15 show3-s show3-r empty 20 12 0 14 -262144\n-66577 0;\n#X obj 70 310 cnv 15 15 15 show4-s show4-r empty 20 12 0 14 -262144\n-66577 0;\n#X obj 70 310 cnv 15 15 15 show5-s show5-r empty 20 12 0 14 -262144\n-66577 0;\n#X obj 70 310 cnv 15 15 15 show6-s show6-r empty 20 12 0 14 -262144\n-66577 0;\n#X obj 70 310 cnv 15 15 15 show7-s show7-r empty 20 12 0 14 -262144\n-66577 0;\n#X text 11 130 Sharing:;\n#X text 11 49 PdWebParty:;\n#X text 11 145 - Upload your patch somewhere on the internet;\n#X text 21 160 (e.g. Patchstorage) and put the download LINK:;\n#X text 21 175 https://pdwebparty.herokuapp.com/?url=LINK;\n#X text 11 64 - Run your pd patches in the browser.;\n#X text 11 80 - GUI objects should have send/receive names.;\n#X text 11 95 - Currently \\, only [bng] \\, [tgl] \\, [cnv] are supported.\n;\n#X text 11 110 - Drag & Drop your pd patch here to upload.;\n#X obj 21 260 bng 120 125 50 0 button-s button-r button 26 60 0 20\n-204786 -4034 -13381;\n#X obj 158 260 tgl 120 0 toggle-s toggle-r toggle 24 60 0 20 -261234\n-258113 -86277 0 1;\n";
        filename = "default.pd";
    }
    loading.style.display = "none";
    openPatch(content, filename);
}

// drag & drop file uploading
function showFilter() {
    filter.style.display = "flex";
}

function hideFilter() {
    filter.style.display = "none";
}

document.addEventListener("dragenter", function (e) {
    e.preventDefault();
    showFilter();
});

filter.addEventListener("dragleave", function (e) {
    e.preventDefault();
    hideFilter();
});

document.addEventListener("dragover", function (e) {
    e.preventDefault();
});

filter.addEventListener("drop", function (e) {
    e.preventDefault();
    hideFilter();
    const file = e.dataTransfer.files[0];
    uploadPatch(file);
});