import FileSource from './file-source';


export default class MemFileSource implements FileSource {

    private files: {
        [path: string]: string | null
    }
    private fileUrls: {
        [path: string]: string
    }

    constructor() {
        this.files = {};
        this.fileUrls = {};
    }

    async getFile(path: string, decrypt: boolean): Promise<string | null> {
        let content: string | null = this.files[path];

        // For a non existant file, return null.
        if(typeof content === 'undefined') {
            content = null;
        }

        return content;
    }
    
    async putFile(path: string, content: string, encrypt: boolean): Promise<void> {
        this.files[path] = content;
    }
    
    async putFileStub(path: string): Promise<void> {
        this.files[path] = null;
    }
        
    async deleteFile(path: string): Promise<void> {
        delete this.files[path];
        // Also delete the url
        delete this.fileUrls[path];
    }
    
    async listFiles(options?: { pathFilter?: string; callback?: (name: string) => boolean; }): Promise<string[]> {
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

    async putFileUrl(path: string, url: string): Promise<void> {
        this.fileUrls[path] = url;
    }
    async getFileUrl(path: string): Promise<string | null> {

        // Don't return something if we have no file.
        if(!this.files[path]) return null;

        return this.fileUrls[path] || null;
    }

    clear(path?: string) {
        if(path) {
            delete this.files[path];
            delete this.fileUrls[path];
        } else {
            this.files = {};
            this.fileUrls = {};
        }
    }
}