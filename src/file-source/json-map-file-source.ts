import FileSource from './file-source';
import { ICachedFileSource } from './cached-file-source';
import nodePath from 'path';
import { v4 as uuid } from 'uuid';

const MAX_ITEMS = 100; // # of JSON objects
const MASTER_FILE_NAME = 'jm-master.json';


interface StoredFileIndex {
    parentPath: string,
    path: string,
    encrypted: boolean,
}

interface FileIndex {
    path: string
    encrypted: boolean
}

interface FileIndexes { 
    [filePath: string]: FileIndex
}
interface JSONMapFile {
    path: string, 
    count: number, 
    encrypted: boolean
}

interface Options {
    maxItems?: number,
    root?: string
}

// A ICachedFileSource, which uses an internal CachedFileSource to
// deal with the actual caching aspect. 
export default class JSONMapFileSource implements ICachedFileSource {

    private fileSource : ICachedFileSource;
    private _fileIndexes: null | FileIndexes = null;
    private _jsonMapFileList: null | Array<JSONMapFile> = null;
    private _jsonMapFileMap: null | {[path: string]: JSONMapFile} = null;

    private options: Options;

    constructor(fileSource: ICachedFileSource, options?: Options) {
        this.fileSource = fileSource;
        
        this.options = Object.assign({}, { 
            maxItems: MAX_ITEMS,
            root: "",
        }, options ? options : {});
    }

    private fullPath(path: string) {
        if(this.options.root) return nodePath.join(this.options.root, path);
        return path;
    }

    private get fileIndexes() : FileIndexes {
        if(!this._fileIndexes) throw new Error("Must call 'load' to load in file indexes");
        return this._fileIndexes!;
    }
    private get jsonMapFileList() : Array<JSONMapFile> {
        if(!this._jsonMapFileList) throw new Error("Must call 'load' to load in JSON map files");
        return this._jsonMapFileList!;
    }

    private get jsonMapFileMap() : { [path:string]: JSONMapFile } {
        if(!this._jsonMapFileMap) throw new Error("Must call 'load' to load in JSON map files");
        return this._jsonMapFileMap!;
    }

    private async resolveFileIndex(path: string) : Promise<FileIndex | null> {
        // Lazy load in our master file index.
        if(!this._fileIndexes) {
            await this.load();
        }
        // At this point we have a valid master.
        const index: FileIndex = this.fileIndexes[path];
        if(index) return index;

        return null;
    }

    private async putJSONImpl(path: string, content: any, encrypt: boolean) {

        let fsContent = "";        
        // Grab a new index
        // Find a jsonMapFile that we can fit into.
        let _jmFile = this.jsonMapFileList.find(jmFile => jmFile.encrypted == encrypt && jmFile.count < this.options.maxItems!);
        if(!_jmFile) {
            // Create a new jsonMapFile.
            _jmFile = {
                path: this.fullPath(uuid()),
                count: 0,
                encrypted: encrypt
            };
            // Add it in
            this.jsonMapFileList.push(_jmFile);
            this.jsonMapFileMap[_jmFile.path] = _jmFile;
            fsContent = "{}";
        } else {
            // Grab existing contents
            const _fsContent = await this.fileSource.getFile(_jmFile.path, _jmFile.encrypted);
            fsContent = !_fsContent ? "{}" : _fsContent;
        }
        let jsContent: { [path: string]: any } = {};
        // If parsing errors exist, just clear it out.
        try { jsContent = JSON.parse(fsContent); } catch(err) { jsContent = {}; }

        // Now add the content into whatever file we've decided on.
        await this.addContents(_jmFile, jsContent, path, content);
    }

    private async addContents(jmFile: JSONMapFile, fileContent: { [path:string]: any }, 
                              path: string, newContent: string) {

        // Update contents in file.
        fileContent[path] = newContent;
        await this.fileSource.putFile(jmFile.path, JSON.stringify(fileContent), jmFile.encrypted);
        // Update file index
        this.fileIndexes[path] = {
            path: jmFile.path,
            encrypted: jmFile.encrypted
        };
        jmFile.count = Object.keys(fileContent).length;
    }

    // Explicit load call if we need to control when the index gets loaded.
    async load() : Promise<void> {
        // Preset props.
        this._fileIndexes = {};
        this._jsonMapFileList = [];
        this._jsonMapFileMap = {};

        // Load the master index
        let masterIndex = await this.fileSource.getFile(this.fullPath(MASTER_FILE_NAME), true);
        if(masterIndex) {
            try {
                const contents : Array<StoredFileIndex> = JSON.parse(masterIndex);
                // Extract and organize info from each stored file index from master
                for(let x=0; x < contents.length;x++) {
                    const index = contents[x];
                    // Save the mapped file index
                    this.fileIndexes[index.path] = {
                        path: index.parentPath,
                        encrypted: index.encrypted
                    };
                    // Create or update the JSON Map
                    let jmFile : JSONMapFile = this._jsonMapFileMap[index.parentPath];
                    if(!jmFile) {
                        jmFile = {
                            path: index.parentPath,
                            encrypted: index.encrypted,
                            count: 1
                        };
                        this._jsonMapFileMap[index.parentPath] = jmFile;
                        this._jsonMapFileList.push(jmFile);
                    } else {
                        // We know about this file, so just update its count.
                        jmFile.count++;
                    }
                }
            } catch(err) {
                throw new Error("Failed to read JSON map master file: " + err);
            }
        }
    }
    // This doesn't need to be public; saving is always done immediately.
    private async save() : Promise<void> {
        if(!this._fileIndexes) throw new Error("Must call 'load' to load in file before saving");

        // Build up our list of stored file indexes.
        const storedFileIndexes = Object.keys(this.fileIndexes)
            .map(path => {
                const fileIndex = this.fileIndexes[path];
                return Object.assign(
                    {},
                    fileIndex,
                    {
                        parentPath: fileIndex.path,
                        path: path
                    }
                );
            });

        // Save out to our master index.
        await this.fileSource.putFile(this.fullPath(MASTER_FILE_NAME), JSON.stringify(storedFileIndexes), true);
    }

    async getFile(path: string, decrypt: boolean): Promise<string | null> {
        // Resolve our real file
        const index = await this.resolveFileIndex(path);
        if(index) {
            let contents = await this.fileSource.getFile(index.path, index.encrypted);
            // File needs to exist.
            if(contents) {
                let jContents = null;
                // Return null if it doesn't parse.
                try { jContents = JSON.parse(contents); } catch(err) { return null; }

                jContents = jContents[path];
                // File contents need to exist.
                if(typeof jContents !== 'undefined' ) {
                    return jContents;
                }
            }
        }
        return null;
    }
    
    async putFile(path: string, content: string, encrypt: boolean): Promise<void> {
        // Resolve our real file
        const index = await this.resolveFileIndex(path);
        if(index) {
            // Grab the jm file
            const jmFile = this.jsonMapFileMap[index.path];

            // We'll need the existing contents
            let fsContent = await this.fileSource.getFile(jmFile.path, jmFile.encrypted);
            let jContents: { [path: string]: any } = {};
            // Default to empty object if we can't parse, or it doesn't exist.
            if(fsContent) {
                try { jContents = JSON.parse(fsContent); } catch(err) {/* No action */ }
            }

            // Replace existing with current contents.
            await this.addContents(jmFile, jContents, path, content);
        } else {
            // No current index found, so create a new one.
            await this.putJSONImpl(path, content, encrypt);
        }
        // Save master after we've made our changes.
        await this.save();
    }
    
    async deleteFile(path: string) : Promise<void> {
        // Resolve our real file
        const index = await this.resolveFileIndex(path);
        if(index) {
            // Grab the jm file
            const jmFile = this.jsonMapFileMap[index.path];

            // We'll need the existing contents
            let fsContent = await this.fileSource.getFile(jmFile.path, jmFile.encrypted);
            let jContents: { [path: string]: any } = {};
            // Default to empty object if we can't parse, or it doesn't exist.
            if(fsContent) {
                try { jContents = JSON.parse(fsContent); } catch(err) {/* No action */ }
            }

            // Remove old content
            delete jContents[path];

            const count = Object.keys(jContents).length;
            if(count) {
                // If there are items left, save out.

                // Save with content removed.
                await this.fileSource.putFile(jmFile.path, JSON.stringify(jContents), jmFile.encrypted);
                // Update old jmFile's recorded size.
                jmFile.count = count;
            } else {
                // Otherwise delete the file.
                await this.fileSource.deleteFile(jmFile.path);

                // And jsonMaps.
                delete this.jsonMapFileMap[jmFile.path];
                const i = this.jsonMapFileList.findIndex(f => f.path == jmFile.path);
                if(i != -1) this.jsonMapFileList.splice(i, 1);
            }

            // Remove the index
            delete this.fileIndexes[path];

            // Save master after we've made our changes.
            await this.save();
        }
    }
    
    async listFiles(options?: { pathFilter?: string, callback?: (name: string) => boolean }): Promise<Array<string>> {
        let files = Object.keys(this.fileIndexes);

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
        throw new Error("Method getFileUrl is unavailable on JSONMapFileSource. Use getFileIndex");
    }

    // Same signature as above, but different meaning.
    async getFileMapUrl(path: string): Promise<string | null> {
        const index = await this.resolveFileIndex(path);
        if(index) {
            return await this.fileSource.getFileUrl(index.path);
        }
        return null;
    }

    get cacheOptions() { return this.fileSource.cacheOptions; }

    async flush(path?: string) : Promise<void> {
        if(path) {
            const index = await this.resolveFileIndex(path);
            if(index) {
                await this.fileSource.flush(index.path);
            }
        } else {
            await this.fileSource.flush();
        }
    }
    async abortChanges(path?: string) : Promise<void> {
        if(path) {
            const index = await this.resolveFileIndex(path);
            if(index) {
                await this.fileSource.abortChanges(index.path);
            }
        } else {
            await this.fileSource.abortChanges();
        }
    }
    async clear(path?: string) : Promise<void> {
        // Be aggressive with clearing.
        if(path) {
            const index = await this.resolveFileIndex(path);
            if(index) {
                await this.fileSource.clear(index.path);
                // If we clear an item in the cache,
                // tell the cache to also clear the master
                await this.fileSource.clear(this.fullPath(MASTER_FILE_NAME));
                // And all indexes here. On next use, this will force
                // a re-load of the master file, and a repopulation of these
                // indexes.
                this._fileIndexes = null;
                this._jsonMapFileList = null;
                this._jsonMapFileMap = null;
            }
        } else {
            await this.fileSource.clear();
            // Clear all indexes as well.
            this._fileIndexes = null;
            this._jsonMapFileList = null;
            this._jsonMapFileMap = null;
        }
    }
}