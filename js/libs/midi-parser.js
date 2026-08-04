/**
 * Minimal MIDI Parser for RPG Maker MZ
 * Based on various open-source lightweight parsers
 */
class MidiParser {
    constructor(data) {
        this.data = new Uint8Array(data);
        this.pos = 0;
    }

    readString(len) {
        let str = '';
        for (let i = 0; i < len; i++) {
            str += String.fromCharCode(this.data[this.pos++]);
        }
        return str;
    }

    readUint32() {
        const v = (this.data[this.pos] << 24) | (this.data[this.pos + 1] << 16) | (this.data[this.pos + 2] << 8) | this.data[this.pos + 3];
        this.pos += 4;
        return v >>> 0;
    }

    readUint16() {
        const v = (this.data[this.pos] << 8) | this.data[this.pos + 1];
        this.pos += 2;
        return v;
    }

    readUint8() {
        return this.data[this.pos++];
    }

    readVarInt() {
        let v = 0;
        while (true) {
            const b = this.readUint8();
            if (b & 0x80) {
                v = (v << 7) | (b & 0x7f);
            } else {
                return (v << 7) | b;
            }
        }
    }

    parse() {
        const header = this.readString(4);
        if (header !== 'MThd') throw new Error('Invalid MIDI header');
        const headerLen = this.readUint32();
        const format = this.readUint16();
        const numTracks = this.readUint16();
        const ticksPerBeat = this.readUint16();

        const tracks = [];
        for (let i = 0; i < numTracks; i++) {
            tracks.push(this.parseTrack());
        }

        return {
            format,
            numTracks,
            ticksPerBeat,
            tracks
        };
    }

    parseTrack() {
        const header = this.readString(4);
        if (header !== 'MTrk') throw new Error('Invalid track header');
        const trackLen = this.readUint32();
        const endPos = this.pos + trackLen;
        const events = [];
        let lastStatus = 0;
        let ticks = 0;

        while (this.pos < endPos) {
            ticks += this.readVarInt();
            let status = this.readUint8();

            if (status < 0x80) {
                status = lastStatus;
                this.pos--;
            }

            if (status < 0xf0) {
                lastStatus = status;
            } else if (status === 0xff) {
                // Meta event - does not affect running status
            } else {
                lastStatus = 0; // Sysex or other system common clear running status
            }

            const type = status & 0xf0;
            const channel = status & 0x0f;

            if (status === 0xff) {
                // Meta event
                const metaType = this.readUint8();
                const len = this.readVarInt();
                const data = this.data.slice(this.pos, this.pos + len);
                this.pos += len;
                events.push({ ticks, type: 'meta', metaType, data });
            } else if (status === 0xf0 || status === 0xf7) {
                // Sysex
                const len = this.readVarInt();
                this.pos += len;
            } else if (type === 0x80 || type === 0x90 || type === 0xa0 || type === 0xb0 || type === 0xe0) {
                const param1 = this.readUint8();
                const param2 = this.readUint8();
                events.push({ ticks, type: type === 0x80 ? 'noteOff' : type === 0x90 ? (param2 === 0 ? 'noteOff' : 'noteOn') : type === 0xa0 ? 'polyAftertouch' : type === 0xb0 ? 'cc' : 'pitchBend', channel, param1, param2 });
            } else if (type === 0xc0 || type === 0xd0) {
                const param1 = this.readUint8();
                events.push({ ticks, type: type === 0xc0 ? 'programChange' : 'channelAftertouch', channel, param1 });
            }
        }

        return events;
    }
}

if (typeof module !== 'undefined') {
    module.exports = MidiParser;
} else {
    window.MidiParser = MidiParser;
}
