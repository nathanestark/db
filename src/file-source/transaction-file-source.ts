import FileSource from './file-source';
import Lockable, { LockType, LockLevel } from '../lockable';

export class Transaction implements FileSource {
        
    private fileSource: FileSource;

    constructor(fileSource: FileSource) {

        this.fileSource = fileSource;
    }

    async getFile(path: string, decrypt: boolean): Promise<string | null> {
        return await this.fileSource.getFile(path, decrypt);
    }

    async putFile(path: string, content: string, encrypt: boolean): Promise<string> {
        return await this.fileSource.putFile(path, content, encrypt);
    }

    async deleteFile(path: string) : Promise<void> {
        return await this.fileSource.deleteFile(path);
    }

    async listFiles(options?: { pathFilter?: string, callback?: (name: string) => boolean }): Promise<Array<string>> {
        return await this.listFiles(options);
    }

    async getFileUrl(path: string): Promise<string | null> {
        return await this.fileSource.getFileUrl(path);
    }

    private locks: {
        [filePath: string]: LockType
    } = {};

    getFileLock(path: string) {
        return this.locks[path];
    }

    addFileLock(path: string, lock: LockType) {
        if(this.locks[path]) throw new Error(`Transaction already has a lock for '${path}'!`);

        this.locks[path] = lock;
    }
}

export default class TransactionFileSource implements FileSource {

    private fileSource: FileSource;

    private lockables: {
        [filePath: string]: Lockable
    } = {};

    constructor(fileSource: FileSource) {

        this.fileSource = fileSource;
    }

    /* Basic FileSource calls */

    async getFile(path: string, decrypt: boolean): Promise<string | null> {
        let contents : null | string = null;
        // If called directly, they should create and commit their own
        // single purpose transaction.
        await this.transact(async (transaction: Transaction) => {
            contents = await this.fileSource.getFile(path, decrypt);
        });

        return contents;
    }

    async putFile(path: string, content: string, encrypt: boolean): Promise<string> {
        let url: null | string = null;
        // If called directly, they should create and commit their own
        // single purpose transaction.
        await this.transact(async (transaction: Transaction) => {
            url = await this.fileSource.putFile(path, content, encrypt);
        });

        return url!;
    }

    async deleteFile(path: string) : Promise<void> {
        // If called directly, they should create and commit their own
        // single purpose transaction.
        await this.transact(async (transaction: Transaction) => {
            await this.fileSource.deleteFile(path);
        });
    }

    async listFiles(options?: { pathFilter?: string, callback?: (name: string) => boolean }): Promise<Array<string>> {
        let files: Array<string> = [];
        // If called directly, they should create and commit their own
        // single purpose transaction.
        await this.transact(async (transaction: Transaction) => {
            files = await this.listFiles(options);
        });

        return files;
    }

    async getFileUrl(path: string): Promise<string | null> {
        let url: null | string = null;
        // If called directly, they should create and commit their own
        // single purpose transaction.
        await this.transact(async (transaction: Transaction) => {
            url = await this.fileSource.getFileUrl(path);
        });

        return url;
    }


    /* Transact powered FileSource calls */

    async getFileWithTransaction(transaction: Transaction, path: string, decrypt: boolean): Promise<string | null> {

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
            lock = lockable.acquire(LockLevel.Read);

            // Add the lock to the transaction.
            transaction.addFileLock(path, lock);
        } else {
            // Transaction already has a lock for this path.
            // Since it is a readOnly lock, we have nothing to do here.
        }

        // Read the file, first from transaction cache, then from this.fileSource

        return await this.fileSource.getFile(path, decrypt);
    }

    async putFileWithTransaction(transaction: Transaction, path: string, content: string, encrypt: boolean): Promise<string> {
        // Does a Lockable exist for this path? Create it if not.

        // Attempt to create a write lock on this Lockable.

        // Add the lock to the transaction.

        // Put the contents in a transaction cache.

        return await this.fileSource.putFile(path, content, encrypt);
    }

    async deleteFileWithTransaction(transaction: Transaction, path: string) : Promise<void> {
        return await this.fileSource.deleteFile(path);
    }

    async listFilesWithTransaction(transaction: Transaction, options?: { pathFilter?: string, callback?: (name: string) => boolean }): Promise<Array<string>> {
        return await this.listFiles(options);
    }

    async getFileUrlWithTransaction(transaction: Transaction, path: string): Promise<string | null> {
        return await this.fileSource.getFileUrl(path);
    }


    /* Transaction utility calls */

    async createTransaction() : Transaction {
        return new Transaction(this);
    }

    async transact(criticalBlock: (transaction: Transaction) => Promise<void>) {
        // Retry logic based on type of error? If error is due to failure
        // to obtain locks, we should retry.

        try {
            const transaction = new Transaction(this);

            await criticalBlock(transaction);

            await this.commit(transaction);
        }
        catch() {
            await this.abort(transaction);
        }
    }

    async commit(transaction: Transaction) {
        // Go through and submit all transaction cache files to
        // this.fileSource

        // Release all locks.
    }

    async abort(transaction: Transaction) {
        // Release all locks.
    }
}