import FileSource from '../src/file-source/file-source';

const READ_DELAY = 50;
const WRITE_DELAY = 75;

export default class MockFileSource implements FileSource {

    static DEFAULT_URL = "https://mock.filesource.nil/files";

    private files: {
        [path: string]: string
    }

    getFileCalls: number = 0;
    putFileCalls: number = 0;
    deleteFileCalls: number = 0;
    listFilesCalls: number = 0;
    getFileUrlCalls: number = 0;

    callDelays: Array<number>;
    callDelayCount: number = 0;

    constructor(callDelays?: Array<number>) {
        this.files = {};
        this.callDelays = callDelays ? callDelays : [];
    }

    private delay(time: number): Promise<void> {
        return new Promise((resolve) => {
            // Use all the callDelays until we're out. Then use provided time.
            let useTime = time;
            if(this.callDelays.length > this.callDelayCount) {
                useTime = this.callDelays[this.callDelayCount];
                this.callDelayCount++;
            }
            setTimeout(() => {
                resolve();
            }, useTime);
        })
    }
    private getPublicUrl(path: string) {
        return MockFileSource.DEFAULT_URL + (path.length > 0 && path[0] == '/' ? "" : "/" )+ path;
    }

    async getFile(path: string, decrypt: boolean): Promise<string | null> {
        this.getFileCalls++;

        await this.delay(READ_DELAY);

        let content: string | null = this.files[path];

        // For a non existant file, return null.
        if(typeof content === 'undefined') {
            content = null;
        }
        return content;
    }
    
    async putFile(path: string, content: string, encrypt: boolean): Promise<void> {
        this.putFileCalls++;

        await this.delay(WRITE_DELAY);

        this.files[path] = content;
    }
    
    async deleteFile(path: string): Promise<void> {
        this.deleteFileCalls++;

        await this.delay(WRITE_DELAY);

        delete this.files[path];
    }
    
    async listFiles(options?: { pathFilter?: string; callback?: (name: string) => boolean; }): Promise<string[]> {
        this.listFilesCalls++;

        await this.delay(READ_DELAY);

        let files = Object.keys(this.files);

        if(options) {
            if(options!.pathFilter) files = files.filter( f => f.startsWith(options!.pathFilter!));
            if(options!.callback) {
                const temp = [];
                for(let x=0;x<files.length;x++) {
                    const file = files[x];
                    if(!options!.callback!(file))
                        break;
                    else {
                        temp.push(file);
                    }
                }
                files = temp;
            }
        }
        return files;
    }

    async getFileUrl(path: string): Promise<string | null> {
        this.getFileUrlCalls++;

        await this.delay(READ_DELAY);

        if(!this.files[path]) {
            return null;
        }
        try {
            return this.getPublicUrl(path);
        }catch(err) {console.log(err)}

        return null;
    }
}