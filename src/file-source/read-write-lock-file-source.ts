import FileSource from './file-source';
import ReadWriteLock from '../read-write-lock';


export default class ReadWriteLockFileSource implements FileSource {

    private fileSource: FileSource;
    private locks: {
        [path:string]: ReadWriteLock
    }

    constructor(fileSource: FileSource) {

        this.fileSource = fileSource;
        this.locks = {};
    }

    private getFileLock(path: string) {
        // Check for an existing lock on this file.
        let lock = this.locks[path];
        if(!lock) {
            // if no lock exists, create one.
            lock = new ReadWriteLock();
            this.locks[path] = lock;
        }
        return lock;
    }

    async getFile(path: string, decrypt: boolean): Promise<string | null> {
        const lock = this.getFileLock(path);
        return await lock.doReadLock(async () => {
            return await this.fileSource.getFile(path, decrypt);
        })
    }

    async putFile(path: string, content: string, encrypt: boolean): Promise<string> {
        const lock = this.getFileLock(path);
        return await lock.doWriteLock(async () => {
            return await this.fileSource.putFile(path, content, encrypt);
        })
    }

    async deleteFile(path: string) : Promise<void> {
        const lock = this.getFileLock(path);
        return await lock.doWriteLock(async () => {
            return await this.fileSource.deleteFile(path);
        })
    }

    async listFiles(options?: { pathFilter?: string, callback?: (name: string) => boolean }): Promise<Array<string>> {
        // List files is trouble. Technically we don't need to handle file level
        // locks for it, but we *should* handle a more global 'list' lock. E.g. a
        // lock specifically for managing the file list. The trouble is that that
        // lock would need to be applied for all writes to _to the list_
        // and for reads to the list. Since we don't control adds/removes from the
        // list, we can't do this without locking out the entire putFile + deleteFile
        // which would unnecessarily harm the parallelism of the writes.

        // So.. for now lets just assume that the underlying storage properly syncs
        // list manipulation, which is a pretty safe bet.

        return await this.listFiles(options);
    }

    async getFileUrl(path: string): Promise<string | null> {
        const lock = this.getFileLock(path);
        return await lock.doReadLock(async () => {
            return await this.fileSource.getFileUrl(path);
        })
    }
}