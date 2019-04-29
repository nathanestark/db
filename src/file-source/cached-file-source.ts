import FileSource from './file-source';

export default class CachedFileSource implements FileSource {
    private fileSource : FileSource;
    private dataCache : { 
        [fileName:string] : {
            timestamp: number
            contents: string | null
        }
    };
    private urlCache : { 
        [fileName:string] : {
            timestamp: number
            url: string | null
        }
    };
    private opts: {
        cacheFileUrls: boolean
    };

    constructor(
        fileSource : FileSource, 
        options?: {
            cacheFileUrls?: boolean
        }
    ) {
        this.fileSource = fileSource;
        this.opts = Object.assign({}, { 
            cacheFileUrls: true 
        }, options ? options : {});

        this.dataCache = {};        
        this.urlCache = {};
    }

    async getFile(path: string, decrypt: boolean): Promise<string | null> {
        // Check for cached contents first.
        let cache = this.dataCache[path];
        if(!cache) {
            // If they don't exist, go to source.
            const rawContents = await this.fileSource.getFile(path, decrypt);

            cache = {
                timestamp: Date.now(),
                contents: rawContents
            };

            // Add to cache. If we didn't receive anything from the remote source,
            // we should stll add that information to the cache.
            this.dataCache[path] = cache;
        }
        return cache.contents;
    }

    async putFile(path: string, content: string, encrypt: boolean): Promise<string> {
        // First put into cache
        this.dataCache[path] = {
            timestamp: Date.now(),
            contents: content
        };

        // Then into source.
        return await this.fileSource.putFile(path, content, encrypt);
    }

    async deleteFile(path: string) : Promise<void> {
        // Delete from data cache
        delete this.dataCache[path];
        // Also delete from url cache; deleting a file means it goes away!
        delete this.urlCache[path];
        
        // Then from file source
        return await this.fileSource.deleteFile(path);
    }

    async listFiles(options?: { pathFilter?: string, callback?: (name: string) => boolean }): Promise<Array<string>> {
        // No cache manipulation for listing files right now.
        return await this.fileSource.listFiles(options);
    }
    
    async getFileUrl(path: string): Promise<string | null> {
        // Should we do caching of URLs?
        if(this.opts.cacheFileUrls) {
            // Check for cached url first.
            let cache = this.urlCache[path];
            if(!cache) {
                // If they don't exist, go to source.
                const rawUrl = await this.fileSource.getFileUrl(path);

                cache = {
                    timestamp: Date.now(),
                    url: rawUrl
                };

                // Add to cache. If we didn't receive anything from the remote source,
                // we should stll add that information to the cache.
                this.urlCache[path] = cache;
            }
            return cache.url;
        }

        // If no caching, just grab the URL.
        const rawUrl = await this.fileSource.getFileUrl(path);
        return rawUrl;
    }

    clear(path: string) {
        this.clearFile(path);
        this.clearFileUrl(path);
    }
    clearFile(path: string) {
        delete this.dataCache[path];
    }
    clearFileUrl(path: string) {
        delete this.urlCache[path];
    }
}