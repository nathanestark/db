import FileSource from './file-source';
import Lockable, { LockType, LockLevel } from '../lockable';
import { rejects } from 'assert';

type Operation = {
    path: string,
    lockLevel: LockLevel,
    criticalSection: () => Promise<any>,
    resolve: (result: any) => void,
    reject: (error:Error) => void,
}

export default class ReadWriteLockFileSource implements FileSource {

    private fileSource: FileSource;
    private lockables: {
        [path:string]: Lockable
    }
    private pending: {
        [path:string]: Array<Operation>
    }

    constructor(fileSource: FileSource) {

        this.fileSource = fileSource;
        this.lockables = {};
        this.pending = {};
    }

    private getPendingQueue(path: string) : Array<Operation> {
        // Check for an existing lock on this file.
        let queue = this.pending[path];
        if(!queue) {
            // if no lock exists, create one.
            queue = [];
            this.pending[path] = queue;
        }
        
        return queue;
    }
    private getFileLock(path: string, level: LockLevel) : LockType {
        // Check for an existing lock on this file.
        let lock = this.lockables[path];
        if(!lock) {
            // if no lock exists, create one.
            lock = new Lockable();
            this.lockables[path] = lock;
        }
        
        
        return lock.createAndAcquire(level);;
    }

    private releaseFileLock(path: string, lock: LockType) {
        let lockable = this.lockables[path];
        if(lockable) {
            lockable.release(lock);
        }
    }

    private doLock(path: string, lockLevel: LockLevel, criticalSection: () => Promise<any>) : Promise<any> {
        return new Promise((resolve: (result: any) => void, reject: (error: Error) => void) => {
            const operation : Operation = {
                path: path,
                lockLevel: lockLevel,
                criticalSection: criticalSection,
                resolve: resolve,
                reject: reject
            };
            // All operations go into pending first.
            this.getPendingQueue(path).push(operation);

            // Then attempt to process the pending queue.
            this.processPending(path);
        });
    }

    private processPending(path: string) {
        const queue = this.getPendingQueue(path);
        // Go through each pending item to see if we can start execution.
        while(queue.length > 0) {
            const next = queue[0];

            // Attempt to acquire the correct lock
            let lock: LockType | null = null;
            try {
                lock = this.getFileLock(next.path, next.lockLevel);
            } catch(err) { /* Failed to get lock! */}

            if(lock) {
                // If we got our lock, we can execute.
                queue.shift();
                
                // Begin executing the lock now.
                next.criticalSection()
                .then((result) => {
                    // Release our lock
                    this.releaseFileLock(path, lock!);

                    // Then resolve.
                    try {
                    next.resolve(result);
                    } catch(err) { console.log("No?");}
                    // Then process the locks again.
                    this.processPending(path);
                })
                .catch((err) => {
                    // Release our lock
                    this.releaseFileLock(path, lock!);

                    // Then reject.
                    next.reject(err);

                    // Then process the locks again.
                    this.processPending(path);
                })
            } else {
                break;
            }
        }
    }


    async getFile(path: string, decrypt: boolean): Promise<string | null> {
        return await this.doLock(path, LockLevel.Read, async () => {
            const result = await this.fileSource.getFile(path, decrypt);
            return result;
        })
    }

    async putFile(path: string, content: string, encrypt: boolean): Promise<void> {
        return await this.doLock(path, LockLevel.Write, async () => {
            return await this.fileSource.putFile(path, content, encrypt);
        })
    }

    async deleteFile(path: string) : Promise<void> {
        return await this.doLock(path, LockLevel.Write, async () => {
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
        return await this.doLock(path, LockLevel.Read, async () => {
            return await this.fileSource.getFileUrl(path);
        })
    }
}