
let id = 0;
const generateId = function() { return id++; }

export enum LockType {
    Read,
    Write
}

interface Lock {
    id: number,
    type: LockType,
    criticalSection: () => Promise<any>,
    resolve: (result: any) => void,
    reject: (error: Error) => void
} 

export default class ReadWriteLock {

    private pending: Array<Lock> = [];
    private writeLock: null | Lock = null;
    private readLocks: Array<Lock> = [];

    doLock(type: LockType, criticalSection: () => Promise<any>) : Promise<any> {
        return new Promise((resolve: (result: any) => void, reject: (error: Error) => void) => {
            const lock: Lock = {
                id: generateId(),
                type: type,
                criticalSection: criticalSection,
                resolve: resolve,
                reject: reject
            };
            // All locks go into pending first.
            this.pending.push(lock);

            // Then attempt to process the pending queue.
            this.processPending();
        });
    }

    doReadLock(criticalSection: () => Promise<any>) : Promise<any>{
        return this.doLock(LockType.Read, criticalSection);
    }

    async doWriteLock(criticalSection: () => Promise<any>) : Promise<any> {
        return this.doLock(LockType.Write, criticalSection);
    }

    private processPending() {

        // Go through each pending item to see if we can start execution.
        while(this.pending.length > 0) {
            const next = this.pending[0];

            // If there's a writeLock active, then we're done.
            // Only one writelock can be active at a time.
            if(this.writeLock) break;
            // If there are readLocks active, and our next lock is
            // a writelock, then we're done.
            else if(this.readLocks.length > 0 && next.type == LockType.Write) break;
            // Otherwise, the next is a read with active readlocks, or
            // there are no active locks.
            else {
                // We can now move this lock to the appropriate active
                // location and start it.
                this.pending.shift();
                if(next.type == LockType.Read) this.readLocks.push(next);
                else this.writeLock = next;
                
                this.executeLock(next);
            }
        }
    }

    private executeLock(lock: Lock) {
        // Begin executing the lock now.
        lock.criticalSection()
        .then((result) => {
            // Clear our lock
            if(lock.type == LockType.Write) this.writeLock = null;
            else if(lock.type == LockType.Read) {
                this.readLocks = this.readLocks.filter(l => l.id != lock.id);
            }

            // Then resolve.
            lock.resolve(result);

            // Then process the locks again.
            this.processPending();
        })
        .catch((err) => {
            // Clear our lock
            if(lock.type == LockType.Write) this.writeLock = null;
            else if(lock.type == LockType.Read) {
                this.readLocks = this.readLocks.filter(l => l.id != lock.id);
            }

            // Then reject.
            lock.reject(err);

            // Then process the locks again.
            this.processPending();
        })
    }
}