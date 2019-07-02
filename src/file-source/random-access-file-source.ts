import FileSource from './file-source';
import { ICachedFileSource } from './cached-file-source';
import nodePath from 'path';
import { v4 as uuid } from 'uuid';

const MAX_FILE_SIZE = 1000000; // # of characters, or 'bytes' (sort of)
const MASTER_FILE_NAME = 'ra-master.json';


interface StoredFileIndex {
    parentPath: string,
    path: string,
    position: number,
    length: number,
    encrypted: boolean,
}

interface FileIndex {
    path: string,
    position: number,
    length: number,
    encrypted: boolean
}

interface FileIndexes { 
    [filePath: string]: FileIndex
}
interface RandomAccessFile {
    path: string, 
    size: number, 
    encrypted: boolean
}

interface Options {
    maxSize?: number,
    root?: string
}

// A ICachedFileSource, which uses an internal CachedFileSource to
// deal with the actual caching aspect. 
export default class RandomAccessFileSource implements ICachedFileSource {

    private fileSource : ICachedFileSource;
    private _fileIndexes: null | FileIndexes = null;
    private _randomAccessFileList: null | Array<RandomAccessFile> = null;
    private _randomAccessFileMap: null | {[path: string]: RandomAccessFile} = null;

    private options: Options;

    constructor(fileSource: ICachedFileSource, options?: Options) {
        this.fileSource = fileSource;
        
        this.options = Object.assign({}, { 
            maxSize: MAX_FILE_SIZE,
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
    private get randomAccessFileList() : Array<RandomAccessFile> {
        if(!this._randomAccessFileList) throw new Error("Must call 'load' to load in random access files");
        return this._randomAccessFileList!;
    }

    private get randomAccessFileMap() : { [path:string]: RandomAccessFile } {
        if(!this._randomAccessFileMap) throw new Error("Must call 'load' to load in random access files");
        return this._randomAccessFileMap!;
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

    private async putFileImpl(path: string, content: string, encrypt: boolean) {

        let fsContent = "";        
        // Grab a new index
        // Find a randomAccessFile that we can fit into.
        let _raFile = this.randomAccessFileList.find(raFile => raFile.encrypted == encrypt && (raFile.size + content.length) <= this.options.maxSize!);
        if(!_raFile) {
            // Create a new randomAccessFile.
            _raFile = {
                path: this.fullPath(uuid()),
                size: 0,
                encrypted: encrypt
            };
            // Add it in
            this.randomAccessFileList.push(_raFile);
            this.randomAccessFileMap[_raFile.path] = _raFile;
            fsContent = "";
        } else {
            // Grab existing contents
            const _fsContent = await this.fileSource.getFile(_raFile.path, _raFile.encrypted);
            fsContent = !_fsContent ? "" : _fsContent;
        }
        // Now add the content into whatever file we've decided on.
        await this.addContents(_raFile, fsContent, path, content);
    }

    private async addContents(raFile: RandomAccessFile, fileContent: string, 
                              path: string, newContent: string) {

        const newPos = fileContent.length;
        // Update contents in file.
        const fsContent = fileContent + newContent;
        await this.fileSource.putFile(raFile.path, fsContent, raFile.encrypted);
        // Update file index
        this.fileIndexes[path] = {
            path: raFile.path,
            position: newPos,
            length: newContent.length,
            encrypted: raFile.encrypted
        };
        raFile.size = fsContent.length;
    }

    // Explicit load call if we need to control when the index gets loaded.
    async load() : Promise<void> {
        // Preset props.
        this._fileIndexes = {};
        this._randomAccessFileList = [];
        this._randomAccessFileMap = {};

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
                        position: index.position,
                        length: index.length,
                        encrypted: index.encrypted
                    };
                    // Create or update the Random File Access
                    let raFile : RandomAccessFile = this._randomAccessFileMap[index.parentPath];
                    if(!raFile) {
                        raFile = {
                            path: index.parentPath,
                            encrypted: index.encrypted,
                            size: index.length
                        };
                        this._randomAccessFileMap[index.parentPath] = raFile;
                        this._randomAccessFileList.push(raFile);
                    } else {
                        // We know about this file, so just update it's size.
                        raFile.size += index.length;
                    }
                }
            } catch(err) {
                throw new Error("Failed to read random access master file: " + err);
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
                contents = contents.substr(index.position, index.length);
                // File contents need to exist.
                if(contents) {
                    return contents;
                }
            }
        }

        return null;
    }
        
    async putFile(path: string, content: string, encrypt: boolean): Promise<void> {
        // Resolve our real file
        const index = await this.resolveFileIndex(path);
        if(index) {
            // Grab the ra file
            const raFile = this.randomAccessFileMap[index.path];

            // We'll need the existing contents
            let fsContent = await this.fileSource.getFile(raFile.path, raFile.encrypted);
            fsContent = !fsContent ? "" : fsContent!;
            // Remove old content block
            fsContent = fsContent.slice(0, index.position) + fsContent.slice(index.position + index.length);
            
            // Go through all indexes
            Object.keys(this.fileIndexes)
                // Pull out those indexes
                .map(path => this.fileIndexes[path])
                // Find those that are saved in the same file, and have a position
                // that would be affected by this change
                .filter(i => i.path == raFile.path && i.position > index.position)
                // Adjust their content positions.
                .forEach(i => {
                    i.position -= index.position;
                });

            // Will current contents fit in this file?
            const newLength = fsContent.length + content.length;
            if(newLength > this.options.maxSize!) {
                // They won't fit.

                // Save old one as is (with the content still excised)
                await this.fileSource.putFile(raFile.path, fsContent, raFile.encrypted);
                // Update old raFile's recorded size.
                raFile.size = fsContent.length;

                // Find somewhere else for the content, and put it there.
                await this.putFileImpl(path, content, encrypt);
            } else {
                // It fits, so add it into this file.
                await this.addContents(raFile, fsContent, path, content);
            }
        } else {
            // No current index found, so create a new one.
            await this.putFileImpl(path, content, encrypt);
        }
        // Save master after we've made our changes.
        await this.save();
    }
    
    async deleteFile(path: string) : Promise<void> {
        // Resolve our real file
        const index = await this.resolveFileIndex(path);
        if(index) {
            // Grab the ra file
            const raFile = this.randomAccessFileMap[index.path];

            // We'll need the existing contents
            let fsContent = await this.fileSource.getFile(raFile.path, raFile.encrypted);
            fsContent = !fsContent ? "" : fsContent!;
            // Remove old content block
            fsContent = fsContent.slice(0, index.position) + fsContent.slice(index.position + index.length);

            // Save old one as is (with the content still excised)
            await this.fileSource.putFile(raFile.path, fsContent, raFile.encrypted);
            // Update old raFile's recorded size.
            raFile.size = fsContent.length;

            // Remove the index
            delete this.fileIndexes[path];

            // Go through all indexes
            Object.keys(this.fileIndexes)
                // Pull out those indexes
                .map(path => this.fileIndexes[path])
                // Find those that are saved in the same file, and have a position
                // that would be affected by this change.
                .filter(i => i.path == raFile.path && i.position > index.position)
                // Adjust their content positions.
                .forEach(i => {
                    i.position -= index.position;
                });

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
        throw new Error("Method getFileUrl is unavailable on RandomAccessFileSource.");
    }

    get cacheOptions() { return this.fileSource.cacheOptions; }

    async flush(path?: string) : Promise<void> {
        await this.fileSource.flush(path);
    }
    async abortChanges(path?: string) : Promise<void> {
        await this.fileSource.abortChanges(path);
    }
    clear(path?: string) : void {
        this.fileSource.clear();
    }
}