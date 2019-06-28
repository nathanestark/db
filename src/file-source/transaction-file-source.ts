import FileSource from './file-source';
import Lockable, { LockType, LockLevel } from '../lockable';
import CachedFileSource from './cached-file-source';

export interface ITransaction extends FileSource {

    getFileLock: (path: string) => LockType
    addFileLock: (path: string, lock: LockType) => void
    replaceFileLock: (path: string, lock: LockType) => void
    getListLock: (level: LockLevel) => null | LockType
    setListLock: (lock: LockType) => void

    commit: () => Promise<void>
    abort: () => Promise<void>
} 

class Transaction implements ITransaction {
        
    private fileSource: TransactionFileSource;
    private isExpired: boolean;
    private doCommit: (locks: Array<{ path?: string, type: LockType}>) => Promise<void>;
    private doAbort: (locks: Array<{ path?: string, type: LockType}>) => Promise<void>;

    constructor(
        fileSource: TransactionFileSource, 
        doCommit: (locks: Array<{ path?: string, type: LockType}>) => Promise<void>, 
        doAbort: (locks: Array<{ path?: string, type: LockType}>) => Promise<void> 
    ) {
        this.fileSource = fileSource;
        this.doCommit = doCommit;
        this.doAbort = doAbort;
        this.isExpired = false;
    }

    async getFile(path: string, decrypt: boolean): Promise<string | null> {
        if(this.isExpired) throw new Error("Transactions cannot be reused.");
        return await this.fileSource.getFileWithTransaction(this, path, decrypt);
    }

    async putFile(path: string, content: string, encrypt: boolean): Promise<void> {
        if(this.isExpired) throw new Error("Transactions cannot be reused.");
        await this.fileSource.putFileWithTransaction(this, path, content, encrypt);
    }

    async deleteFile(path: string) : Promise<void> {
        if(this.isExpired) throw new Error("Transactions cannot be reused.");
        return await this.fileSource.deleteFileWithTransaction(this, path);
    }

    async listFiles(options?: { pathFilter?: string, callback?: (name: string) => boolean }): Promise<Array<string>> {
        if(this.isExpired) throw new Error("Transactions cannot be reused.");
        return await this.fileSource.listFilesWithTransaction(this, options);
    }

    async getFileUrl(path: string): Promise<string | null> {
        if(this.isExpired) throw new Error("Transactions cannot be reused.");
        return await this.fileSource.getFileUrlWithTransaction(this, path);
    }

    private locks: {
        [filePath: string]: LockType
    } = {};

    private listLock: {
        read: null | LockType,
        write: null | LockType,
    } = { read: null, write: null };

    getFileLock(path: string) {
        return this.locks[path];
    }

    addFileLock(path: string, lock: LockType) {
        if(this.locks[path]) throw new Error(`Transaction already has a lock for '${path}'!`);

        this.locks[path] = lock;
    }

    replaceFileLock(path: string, lock: LockType) {
        if(this.locks[path] && this.locks[path].id != lock.id) throw new Error(`Transaction already has a lock for '${path}'!`);

        this.locks[path] = lock;
    }

    getListLock(level: LockLevel) {
        return level == LockLevel.Read ? this.listLock.read : this.listLock.write;
    }

    setListLock(lock: LockType) {
        if(lock.level == LockLevel.Read) this.listLock.read = lock;
        if(lock.level == LockLevel.Write) this.listLock.write = lock;
    }

    private end() : Array<{ path?: string, type: LockType}> {
        this.isExpired = true;
        let locks : Array<{ path?: string, type: LockType}>
            = Object.keys(this.locks).map(lock => {
                return {
                    path: lock,
                    type: this.locks[lock]
                }
            });

        if(this.listLock.read) locks.push({ type: this.listLock.read });
        if(this.listLock.write) locks.push({ type: this.listLock.write });

        return locks;
    }

    async commit() {
        await this.doCommit(this.end());
    }

    async abort() {
        await this.doAbort(this.end());
    }
}

export default class TransactionFileSource implements FileSource {

    private fileSource: CachedFileSource;

    private lockables: {
        [filePath: string]: Lockable
    } = {};
    private listLocks: Array<LockType> = [];

    constructor(fileSource: FileSource) {

        this.fileSource = new CachedFileSource(fileSource, { autoFlushing: false });
    }

    /* Basic FileSource calls */

    async getFile(path: string, decrypt: boolean): Promise<string | null> {
        let contents : null | string = null;
        // If called directly, they should create and commit their own
        // single purpose transaction.
        await this.transact(async (transaction: ITransaction) => {
            contents = await transaction.getFile(path, decrypt);
        });

        return contents;
    }

    async putFile(path: string, content: string, encrypt: boolean): Promise<void> {
        // If called directly, they should create and commit their own
        // single purpose transaction.
        await this.transact(async (transaction: ITransaction) => {
            await this.fileSource.putFile(path, content, encrypt);
        });
    }

    async deleteFile(path: string) : Promise<void> {
        // If called directly, they should create and commit their own
        // single purpose transaction.
        await this.transact(async (transaction: ITransaction) => {
            await this.fileSource.deleteFile(path);
        });
    }

    async listFiles(options?: { pathFilter?: string, callback?: (name: string) => boolean }): Promise<Array<string>> {
        let files: Array<string> = [];
        // If called directly, they should create and commit their own
        // single purpose transaction.
        await this.transact(async (transaction: ITransaction) => {
            files = await this.fileSource.listFiles(options);
        });

        return files;
    }

    async getFileUrl(path: string): Promise<string | null> {
        let url: null | string = null;
        // If called directly, they should create and commit their own
        // single purpose transaction.
        await this.transact(async (transaction: ITransaction) => {
            url = await this.fileSource.getFileUrl(path);
        });

        return url;
    }


    /* Transact powered FileSource calls */

    private negotiateReadLock(transaction: Transaction, path: string) {
        // Does this transaction have a lock for this path already?
        let lock = transaction.getFileLock(path);
        if(!lock) {
            // Does a Lockable exist for this path? Create it if not.
            let lockable = this.lockables[path];
            if(!lockable) {
                lockable = new Lockable();
                this.lockables[path] = lockable;
            }

            // Attempt to create a read lock on this Lockable.
            lock = lockable.createAndAcquire(LockLevel.Read);

            // Add the lock to the transaction.
            transaction.addFileLock(path, lock);
        } else {
            // We can hold either a readlock or a writelock (which is also a readlock).
            // If a Transaction already has a lock for this path, then
            // we hold a readlock by default.
            // Nothing else to do.
        }
    }

    private negotiateWriteLock(transaction: Transaction, path: string) {
        // Does a Lockable exist for this path? Create it if not.
        let lockable = this.lockables[path];
        if(!lockable) {
            lockable = new Lockable();
            this.lockables[path] = lockable;
        }

        // Does this transaction have a lock for this path already?
        let lock = transaction.getFileLock(path);
        if(!lock) {

            // Attempt to create a write lock on this Lockable.
            lock = lockable.createAndAcquire(LockLevel.Write);

            // Add the lock to the transaction.
            transaction.addFileLock(path, lock);
        } else {
            // Transaction already has a lock for this path.
            // It may just be a readlock, so attempt to upgrade it.
            lock = lockable.upgrade(lock);

            transaction.replaceFileLock(path, lock);
        }
    }

    private negotiateListReadLock(transaction: Transaction) {   
        // ListWrites act differently. We don't want to treat it as
        // a lockable resource, since that would just be the same
        // as a global lock for any reads (bad). Instead, let read requests
        // build up, and prevent write requests, but not prevent each other.
        // Can this stuff be merged into the Lockable as a different.. LockableType?
     
        // Does this transaction have a lock for the list already??
        // Read first, Write second.
        let lock = transaction.getListLock(LockLevel.Read) || transaction.getListLock(LockLevel.Write);
        if(!lock) {

            // We can't get a read lock if there are any write locks.
            if(this.listLocks.some(l => l.level == LockLevel.Write)) {
                // Throw a lock error.
                throw new Error("Failed to acquire lock.");
            }
            
            // Attempt to create a read lock on this Lockable.
            lock = Lockable.createLock(LockLevel.Read);
            // Add it to our list.
            this.listLocks.push(lock);

            // Add the lock to the transaction.
            transaction.setListLock(lock);
        } else if(lock.level == LockLevel.Write) {
            // Transaction already has a read lock for the list.
            // We want to add a read lock, but can't if there are any other write locks.
            if(this.listLocks.some(l => l.level == LockLevel.Write && l.id != lock!.id)) {
                // Throw a lock error.
                throw new Error("Failed to acquire lock.");
            }
            // Add new read lock.
            const newLock = Object.assign({}, lock, { level: LockLevel.Read});
            this.listLocks.push(newLock);
            transaction.setListLock(newLock);
        } else {
            // If it already has a read, nothing to be done.
        }
    }
    
    private negotiateListWriteLock(transaction: Transaction) {
        // ListWrites act differently. We don't want to treat it as
        // a lockable resource, since that would just be the same
        // as a global lock for any writes/reads (bad). Instead, let write requests
        // build up, and prevent read requests, but not prevent each other.
        // Can this stuff be merged into the Lockable as a different.. LockableType?
     
        // Does this transaction have a lock for the list already??
        // Write first, Read second.
        let lock = transaction.getListLock(LockLevel.Write) || transaction.getListLock(LockLevel.Read);
        if(!lock) {

            // We can't get a write lock if there are any read locks.
            if(this.listLocks.some(l => l.level == LockLevel.Read)) {
                // Throw a lock error.
                throw new Error("Failed to acquire lock.");
            }
            
            // Attempt to create a write lock on this Lockable.
            lock = Lockable.createLock(LockLevel.Write);
            // Add it to our list.
            this.listLocks.push(lock);

            // Add the lock to the transaction.
            transaction.setListLock(lock);
        } else if(lock.level == LockLevel.Read) {
            // Transaction already has a read lock for the list.
            // We want to add a write lock, but can't if there are any other read locks.
            if(this.listLocks.some(l => l.level == LockLevel.Read && l.id != lock!.id)) {
                // Throw a lock error.
                throw new Error("Failed to acquire lock.");
            }
            // Add new write lock.
            const newLock = Object.assign({}, lock, { level: LockLevel.Write});
            this.listLocks.push(newLock);
            transaction.setListLock(newLock);
        } else {
            // If it already has a write, nothing to be done.
        }
    }

    async getFileWithTransaction(transaction: Transaction, path: string, decrypt: boolean): Promise<string | null> {
        this.negotiateReadLock(transaction, path);

        return await this.fileSource.getFile(path, decrypt);
    }

    async putFileWithTransaction(transaction: Transaction, path: string, content: string, encrypt: boolean): Promise<void> {
        this.negotiateWriteLock(transaction, path);
        // When we 'put' file, we don't know if we are creating or updating
        // so we have to lock out the list regardless.
        this.negotiateListWriteLock(transaction);
        
        await this.fileSource.putFile(path, content, encrypt);
    }

    async deleteFileWithTransaction(transaction: Transaction, path: string) : Promise<void> {
        this.negotiateWriteLock(transaction, path);
        // When we delete a file, we're not *technically* modifying
        // the file list right now, since we know 'delete' is just setting a file
        // to empty, and not removing it.
        // However, this is unexpected behavior, and we anticipate that changing
        // in the near future, so make sure a lock is in place.
        this.negotiateListWriteLock(transaction);

        return await this.fileSource.deleteFile(path);
    }

    async listFilesWithTransaction(transaction: Transaction, options?: { pathFilter?: string, callback?: (name: string) => boolean }): Promise<Array<string>> {
        
        this.negotiateListReadLock(transaction);

        return await this.fileSource.listFiles(options);
    }

    async getFileUrlWithTransaction(transaction: Transaction, path: string): Promise<string | null> {
        this.negotiateReadLock(transaction, path);

        return await this.fileSource.getFileUrl(path);
    }


    /* Transaction utility calls */

    async createTransaction() : Promise<ITransaction> {
        return new Transaction(this, this.commit.bind(this), this.abort.bind(this));
    }

    async transact(criticalBlock: (transaction: ITransaction) => Promise<void>) {
        // Retry logic based on type of error? If error is due to failure
        // to obtain locks, we should retry.

        const transaction = await this.createTransaction();
        try {
            await criticalBlock(transaction);

            await transaction.commit();
        }
        catch(e) {
            await transaction.abort();
            throw e; // Rethrow after aborting.
        }
    }

    private async commit(locks: Array<{ path?: string, type: LockType}>) {
        // Go through and submit any modified cache files associated 
        // with this transaction.
        await Promise.all(
            locks
            .filter(lock => lock.path && lock.type.level == LockLevel.Write)
            .map(async lock => {
                await this.fileSource.flush(lock.path);
            })
        );
        
        // Release all locks. Must be done after all updates.
        await Promise.all(locks.map(async lock => {
            if(lock.path) {
                const lockable = this.lockables[lock.path!];
                lockable!.release(lock.type);
                // Clear the lockable on that file if this was the last lock
                if(!lockable!.isLocked) delete this.lockables[lock.path];
            } else {
                const iLock = this.listLocks.findIndex(l => l.id == lock.type.id && l.level == lock.type.level);
                if(iLock != -1) this.listLocks.splice(iLock, 1);
            }
        }));
    }

    private async abort(locks: Array<{ path?: string, type: LockType}>) {
        // Go through and clear any modified cache files associated 
        // with this transaction.
        await Promise.all(
            locks
            .filter(lock => lock.path && lock.type.level == LockLevel.Write)
            .map(async lock => {
                await this.fileSource.abortChanges(lock.path);
            })
        );
        
        // Release all locks. Must be done after all updates.
        await Promise.all(locks.map(async lock => {
            if(lock.path) {
                const lockable = this.lockables[lock.path!];
                lockable!.release(lock.type);
                // Clear the lockable on that file if this was the last lock
                if(!lockable!.isLocked) delete this.lockables[lock.path];
            } else {
                const iLock = this.listLocks.findIndex(l => l.id == lock.type.id && l.level == lock.type.level);
                if(iLock != -1) this.listLocks.splice(iLock, 1);
            }
        }));
    }
}