import FileSource from './file-source';
import MemFileSource from './mem-file-source';

enum Modification {
    Updated,
    Deleted
}

export interface Options {
    cacheFileUrls?: boolean,
    autoFlushing?: boolean
}

export interface ICachedFileSource extends FileSource {
    readonly cacheOptions: Options
    getFile(path: string, decrypt: boolean): Promise<string | null>
    putFile(path: string, content: string, encrypt: boolean): Promise<void>
    deleteFile(path: string) : Promise<void>
    listFiles(options?: { pathFilter?: string, callback?: (name: string) => boolean }): Promise<Array<string>>
    getFileUrl(path: string): Promise<string | null>

    flush(path?: string) : Promise<void>
    abortChanges(path?: string) : Promise<void>
    clear(path?: string) : void
}

export default class CachedFileSource implements ICachedFileSource {
    private fileSource : FileSource;
    private originalCache: MemFileSource;
    private cache: MemFileSource;
    private negativeCache: {
        [fileName:string] : boolean
    };
    private modifications : { 
        [fileName:string] : { type: Modification, encrypted: boolean }
    };
    private hasList: boolean;
    // We need to keep track of the last encrypt state on reads
    // so we know how to deal with restorations.
    private lastEncryptState: {
        [fileName: string]: boolean
    }
    private originalEncryptState: {
        [fileName: string]: boolean
    }

    private options: Options;
    get cacheOptions() { return this.options; }

    constructor(
        fileSource : FileSource, 
        options?: Options
    ) {
        this.fileSource = fileSource;

        this.options = Object.assign({}, { 
            cacheFileUrls: true, 
            autoFlushing: true
        }, options ? options : {});

        this.cache = new MemFileSource();
        this.originalCache = new MemFileSource();
        this.negativeCache = {};
        this.modifications = {};
        this.hasList = false;
        this.lastEncryptState = {};
        this.originalEncryptState = {};
    }

    private isDeleted(path: string) {
        const mod = this.modifications[path];
        return mod && mod.type == Modification.Deleted;
    }

    private getLastEncryptState(path: string) {
        return !!this.lastEncryptState[path];
    }
    private getOriginalEncryptState(path: string) {
        return !!this.originalEncryptState[path];
    }

    async getFile(path: string, decrypt: boolean): Promise<string | null> {
        // If it was deliberately deleted, or negative cached, it isn't here.
        if(this.isDeleted(path)) return null;
        if(this.negativeCache[path]) return null;

        // Check for cached contents.
        let cache = await this.cache.getFile(path, decrypt);
        if(!cache) {
            // If they don't exist, go to source.
            const contents = await this.fileSource.getFile(path, decrypt);
            if(contents) await this.cache.putFile(path, contents, decrypt);
            else this.negativeCache[path] = true;
        }
        this.lastEncryptState[path] = decrypt;
        return cache;
    }

    async putFile(path: string, content: string, encrypt: boolean): Promise<void> {
        // First, if we don't have an original,
        // grab our current cache value to be used as the original.
        const orig = await this.originalCache.getFile(path, this.getOriginalEncryptState(path));
        if(!orig) {
            const curEncrypt = this.getLastEncryptState(path);
            const cur = await this.cache.getFile(path, curEncrypt);
            if(cur) {
                await this.originalCache.putFile(path, cur, curEncrypt);
                this.originalEncryptState[path] = curEncrypt;
            }
            // If we don't have a version in cache, than we know to reset
            // the cache to empty, and we don't have to set anything in originalCache
        }

        // Then put changes into cache
        await this.cache.putFile(path, content, encrypt);
        this.lastEncryptState[path] = encrypt;

        // Make sure it is marked as updated (any previous 'delete' is
        // no longer relevent).
        this.modifications[path] = { type: Modification.Updated, encrypted: encrypt };
        // Then clear negative caching marks
        delete this.negativeCache[path];

        // Then into source.
        if(this.options.autoFlushing) await this.flush(path);
    }

    async deleteFile(path: string) : Promise<void> {
        // First, if we don't have an original,
        // grab our current cache value to be used as the original.
        const orig = await this.originalCache.getFile(path, this.getOriginalEncryptState(path));
        if(!orig) {
            const curEncrypt = this.getLastEncryptState(path);
            const cur = await this.cache.getFile(path, curEncrypt);
            if(cur) {
                await this.originalCache.putFile(path, cur, curEncrypt);
                this.originalEncryptState[path] = curEncrypt;
            }
            // If we don't have a version in cache, than we know to reset
            // the cache to empty, and we don't have to set anything in originalCache
        }

        // Then delete from cache
        await this.cache.deleteFile(path);
        // Update modifications
        this.modifications[path] = { type: Modification.Deleted, encrypted: false };
        // Set negative cache to true (the file was deleted, so we don't have to
        // check source for it)
        this.negativeCache[path] = true;
        
        // Then from file source
        if(this.options.autoFlushing) await this.flush(path);
    }

    async listFiles(options?: { pathFilter?: string, callback?: (name: string) => boolean }): Promise<Array<string>> {
        if(!this.hasList) {
            // If we haven't listed files yet, get a list of *all* files.
            const list = await this.fileSource.listFiles({
                callback: (name: string) => {
                    // We want to not return this item in our list if it is already
                    // in our 'deleted' list
                    return this.isDeleted(name);
                }
            });

            // Go through each item in the list, and add 'null' as contents
            // to our memory, so that the cache list returns properly.
            await Promise.all(list.map(async (path) => {
                await this.cache.putFileStub(path)
            }))
            // Now we have the list.
            this.hasList = true;
        }

        return await this.cache.listFiles(options);
    }
    
    async getFileUrl(path: string): Promise<string | null> {
        // Should we do caching of URLs?
        if(this.options.cacheFileUrls) {
            const rawUrl = await this.fileSource.getFileUrl(path);
            return rawUrl;
        }


        // If it was deliberately deleted, or negative cached, it isn't here.
        if(this.isDeleted(path)) return null;
        if(this.negativeCache[path]) return null;

        // Check for cached contents.
        let cache = await this.cache.getFileUrl(path);
        if(!cache) {
            // If it doesn't exist, go to source.
            const url = await this.fileSource.getFileUrl(path);

            // Add it into our cache
            if(url) await this.cache.putFileUrl(path, url);
            // We can safely add to negative cache, since if the file URL doesn't exist
            // then it is not a file.
            else this.negativeCache[path] = true;
        }
        return cache;
    }

    async flush(path?: string) {

        const flushOne = async (path: string, mod: { type: Modification, encrypted: boolean}): Promise<void> => {
            if(mod.type == Modification.Deleted) {
                await this.fileSource.deleteFile(path);
            } else if(mod.type == Modification.Updated) {
                const contents = await this.cache.getFile(path, mod.encrypted);
                await this.fileSource.putFile(path, contents!, mod.encrypted);
            }
        };

        // Go through all modifications and apply them.
        if(path) {
            const mod = this.modifications[path];
            if(mod) {
                await flushOne(path, mod);
                // Clear modification
                delete this.modifications[path];
                // Clear original file.
                this.originalCache.clear(path);
                delete this.originalEncryptState[path];
            }
        } else {
            await Promise.all(Object.keys(this.modifications).map(async (path) => {
                const mod = this.modifications[path];
                await flushOne(path, mod);
            }));
            // Clear modifications
            this.modifications = {};
            this.originalCache.clear();
            this.originalEncryptState = {};
        }
    }

    async abortChanges(path?: string) {
        // Go through all modifications, and revert them to originals.
        if(path) {
            const mod = this.modifications[path];
            if(mod) {
                // Revert to originals.
                const origEncrypt = this.getOriginalEncryptState(path);
                const orig = await this.originalCache.getFile(path, origEncrypt);
                await this.cache.putFile(path, orig!, origEncrypt);
                this.lastEncryptState[path] = origEncrypt;

                // Clear modification
                delete this.modifications[path];
                // Leave originals as is.
            }
        } else {
            await Promise.all(Object.keys(this.modifications).map(async (path) => {
                const mod = this.modifications[path];

                // Revert to originals.
                const origEncrypt = this.getOriginalEncryptState(path);
                const orig = await this.originalCache.getFile(path, origEncrypt);
                await this.cache.putFile(path, orig!, origEncrypt);
                this.lastEncryptState[path] = origEncrypt;
            }));
            // Clear modifications
            this.modifications = {};
        }
    }

    clear(path?: string) {
        this.cache.clear(path);
        this.originalCache.clear(path);
        if(path) {
            delete this.modifications[path];
            delete this.negativeCache[path];
            delete this.originalEncryptState[path];
            delete this.lastEncryptState[path];
        } else {
            this.modifications = {};
            this.negativeCache = {};
            this.originalEncryptState = {};
            this.lastEncryptState = {};
        }
        // We have to invalidate the entire list regardless of
        // if we clear one item or all.
        this.hasList = false;
    }
}