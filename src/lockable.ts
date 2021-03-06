import { v4 as uuid } from 'uuid';


export enum LockLevel {
    Read,
    Write
}

export interface LockType {
    readonly level: LockLevel,
    readonly id: string,
    readonly created: number
}

export default class Lockable {
    private writeLock: null | LockType = null;
    private readLocks: Array<LockType> = [];
    //private pendingUpgrade: null | () => void = null; 

    static createLock(level: LockLevel) : LockType {
        return {
            level: level,
            id: uuid(),
            created: Date.now(),
        };
    }

    createAndAcquire(level: LockLevel) : LockType {
        // Create a new lock to acquire.
        const lock: LockType = Lockable.createLock(level);
        
        // Acquire it.
        if(!this._acquire(lock)) {
            // Throw an error if we fail
            throw new Error("Failed to acquire lock.");
        }

        return lock;
    }

    upgrade(lock: LockType) : LockType {
        // If we're already a writelock, Just return the writelock.
        if(this.writeLock && this.writeLock.id == lock.id) return this.writeLock;

        // Create a copy of their submitted lock using the new lock level.
        const newLock = Object.assign({}, lock, { level: LockLevel.Write });
        if(!this._acquire(newLock)) {
            throw new Error("Failed to acquire lock.");
        }

        return newLock;
    }

    private _acquire(lock: LockType) : boolean {
        // If a writeLock exists (and it isn't us) no new lock can be acquired.
        if(this.writeLock && this.writeLock.id != lock.id) return false;
        
        // If a writeLock is requested, and there are readlocks other than our
        // own lock, we should fail.
        else if(lock.level == LockLevel.Write // We're a write lock
            && this.readLocks.length != 0 // There are other read locks
            && (this.readLocks.length != 1 // More than 1 other readlock
                || this.readLocks[0].id != lock.id // Or the only one isn't us
            )
        ) return false;

        // Otherwise, we can allow the lock
        else {
            // If it is a readlock, we need to be in the list.
            if(lock.level == LockLevel.Read) {
                // If we're not already a writelock, and we're not already in the list...
                if((this.writeLock && this.writeLock.id == lock.id) 
                    || !this.readLocks.find(l => l.id == lock.id)) {
                    // Add us.
                    this.readLocks.push(lock);
                }
            }
            // If it is a writelock, consider it an upgrade.
            // We shouldn't be in read, and we should be the write.
            else {
                // If it is a upgrade, remove us from reads.
                if(this.readLocks.length == 1 && this.readLocks[0].id == lock.id) {
                    this.readLocks.shift();
                }
                // Set us as the write.
                this.writeLock = lock;
            }

            return true;
        }
    }

    release(lock: LockType) {
        // Are we dealing with a write lock?
        if(lock.level == LockLevel.Write) {
            // Is it _our_ writelock? Then clear it.
            if(this.writeLock && this.writeLock.id == lock.id) this.writeLock = null;
        }
        // Otherwise it is a read lock
        else {
            // Find the index, and if it exists remove it from our list.
            const index = this.readLocks.findIndex(l => l.id == lock.id);
            if(index > -1) this.readLocks.splice(index, 1);
        }
    }

    get isLocked(){
        return this.writeLock || this.readLocks.length > 0;
    }
}