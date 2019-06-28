import FileSource from '../../src/file-source/file-source';
import TransactionFileSource, { ITransaction } from '../../src/file-source/transaction-file-source';
import MockFileSource from '../mock-file-source';


test("Test the transaction file source", async () => {
    // Perform some actions
    const performOps = async (s: FileSource) => { 
        await s.getFile("file1", false);
        await s.putFile("file1", "Some content", false);
        await s.putFile("file2", "Some other content", false);
        await s.getFile("file1", false);
        await s.getFile("file2", false);
        await s.getFile("file2", false);
        await s.getFile("file1", false);
        await s.getFile("file2", false);
        await s.putFile("file1", "Updated content", false);
        await s.getFile("file1", false);
        await s.putFile("file2", "Some other updated content", false);
        await s.getFile("file1", false);
        await s.getFile("file2", false);
        await s.getFile("file1", false);
        await s.listFiles();
        await s.getFile("file1", false);
        await s.getFile("file2", false);
        await s.deleteFile("file1");
        await s.getFile("file2", false);
        await s.deleteFile("file1");
    };

    // Perform directly on the mock.
    const mSource = new MockFileSource();
    await performOps(mSource);

    expect(mSource.getFileCalls).toBe(13);
    expect(mSource.putFileCalls).toBe(4);
    expect(mSource.deleteFileCalls).toBe(2);
    expect(mSource.listFilesCalls).toBe(1);

    // Perform transaction version.
    const mSource2 = new MockFileSource();
    const tSource = new TransactionFileSource(mSource2);
    await tSource.transact(async (transaction) => {
        await performOps(transaction);
    });

    expect(mSource2.getFileCalls).toBe(1);
    expect(mSource2.putFileCalls).toBe(1);
    expect(mSource2.deleteFileCalls).toBe(1);
    expect(mSource2.listFilesCalls).toBe(1);

    // Ensure transactions restrict access
    const mSource3 = new MockFileSource();
    const tSource2 = new TransactionFileSource(mSource3);

    const performDualTransaction = async (fn: (trans1: ITransaction, trans2: ITransaction) => Promise<void>): Promise<boolean> => {
        const trans1 = await tSource2.createTransaction();
        const trans2 = await tSource2.createTransaction();

        try {
            await fn(trans1, trans2);
        } catch(ex) {
            return false;
        } finally {
            await trans1.abort();
            await trans2.abort();
        }
        return true;
    };

    // Both transactions can read.
    expect(await performDualTransaction(async (trans1: ITransaction, trans2: ITransaction) => {
        await trans1.getFile('file1', false);
        await trans2.getFile('file1', false);
    })).toBe(true);
    // Second transaction can't read.
    expect(await performDualTransaction(async (trans1: ITransaction, trans2: ITransaction) => {
        await trans1.putFile('file1', "content", false);
        await trans2.getFile('file1', false);
    })).toBe(false);
    // Second transaction can't read.
    expect(await performDualTransaction(async (trans1: ITransaction, trans2: ITransaction) => {
        await trans1.deleteFile('file1');
        await trans2.getFile('file1', false);
    })).toBe(false);
    // Second transaction can't write.
    expect(await performDualTransaction(async (trans1: ITransaction, trans2: ITransaction) => {
        await trans1.getFile('file1', false);
        await trans2.putFile('file1', "content", false);
    })).toBe(false);
    // Second transaction can't write.
    expect(await performDualTransaction(async (trans1: ITransaction, trans2: ITransaction) => {
        await trans1.putFile('file1', "content", false);
        await trans2.putFile('file1', "content", false);
    })).toBe(false);
    // Second transaction can't write.
    expect(await performDualTransaction(async (trans1: ITransaction, trans2: ITransaction) => {
        await trans1.deleteFile('file1');
        await trans2.putFile('file1', "content", false);
    })).toBe(false);
    // Second transaction can't delete.
    expect(await performDualTransaction(async (trans1: ITransaction, trans2: ITransaction) => {
        await trans1.getFile('file1', false);
        await trans2.deleteFile('file1',);
    })).toBe(false);
    // Second transaction can't delete.
    expect(await performDualTransaction(async (trans1: ITransaction, trans2: ITransaction) => {
        await trans1.putFile('file1', "content", false);
        await trans2.deleteFile('file1',);
    })).toBe(false);
    // Second transaction can't delete.
    expect(await performDualTransaction(async (trans1: ITransaction, trans2: ITransaction) => {
        await trans1.deleteFile('file1',);
        await trans2.deleteFile('file1',);
    })).toBe(false);

    // Second transaction can read (diff files).
    expect(await performDualTransaction(async (trans1: ITransaction, trans2: ITransaction) => {
        await trans1.putFile('file1', "content", false);
        await trans2.getFile('file2', false);
    })).toBe(true);
    // Second transaction can read (diff files).
    expect(await performDualTransaction(async (trans1: ITransaction, trans2: ITransaction) => {
        await trans1.deleteFile('file1');
        await trans2.getFile('file2', false);
    })).toBe(true);
    // Second transaction can write (diff files).
    expect(await performDualTransaction(async (trans1: ITransaction, trans2: ITransaction) => {
        await trans1.getFile('file1', false);
        await trans2.putFile('file2', "content", false);
    })).toBe(true);
    // Second transaction can write (diff files).
    expect(await performDualTransaction(async (trans1: ITransaction, trans2: ITransaction) => {
        await trans1.putFile('file1', "content", false);
        await trans2.putFile('file2', "content", false);
    })).toBe(true);
    // Second transaction can write (diff files). 
    expect(await performDualTransaction(async (trans1: ITransaction, trans2: ITransaction) => {
        await trans1.deleteFile('file1');
        await trans2.putFile('file2', "content", false);
    })).toBe(true);
    // Second transaction can delete (diff files).
    expect(await performDualTransaction(async (trans1: ITransaction, trans2: ITransaction) => {
        await trans1.getFile('file1', false);
        await trans2.deleteFile('file2',);
    })).toBe(true);
    // Second transaction can delete (diff files).
    expect(await performDualTransaction(async (trans1: ITransaction, trans2: ITransaction) => {
        await trans1.putFile('file1', "content", false);
        await trans2.deleteFile('file2',);
    })).toBe(true);
    // Second transaction can delete (diff files).
    expect(await performDualTransaction(async (trans1: ITransaction, trans2: ITransaction) => {
        await trans1.deleteFile('file1',);
        await trans2.deleteFile('file2',);
    })).toBe(true);
    // Second transaction can read, first can't write.
    expect(await performDualTransaction(async (trans1: ITransaction, trans2: ITransaction) => {
        await trans1.getFile('file1', false);
        await trans2.getFile('file1', false);
        await trans1.putFile('file1', "content", false);
    })).toBe(false);
    // Second transaction can read, first can't delete.
    expect(await performDualTransaction(async (trans1: ITransaction, trans2: ITransaction) => {
        await trans1.getFile('file1', false);
        await trans2.getFile('file1', false);
        await trans1.deleteFile('file1');
    })).toBe(false);
    // First transaction can read, second can list.
    expect(await performDualTransaction(async (trans1: ITransaction, trans2: ITransaction) => {
        await trans1.getFile('file1', false);
        await trans2.listFiles();
    })).toBe(true);
    // First transaction can write, second can't list.
    expect(await performDualTransaction(async (trans1: ITransaction, trans2: ITransaction) => {
        await trans1.putFile('file1', "content", false);
        await trans2.listFiles();
    })).toBe(false);
    // First transaction can delete, second can't list.
    expect(await performDualTransaction(async (trans1: ITransaction, trans2: ITransaction) => {
        await trans1.deleteFile('file1');
        await trans2.listFiles();
    })).toBe(false);
    // First transaction can list, second can read.
    expect(await performDualTransaction(async (trans1: ITransaction, trans2: ITransaction) => {
        await trans1.listFiles();
        await trans2.getFile('file1', false);
    })).toBe(true);
    // First transaction can list, second can't write.
    expect(await performDualTransaction(async (trans1: ITransaction, trans2: ITransaction) => {
        await trans1.listFiles();
        await trans2.putFile('file1', "content", false);
    })).toBe(false);
    // First transaction can list, second can't delete.
    expect(await performDualTransaction(async (trans1: ITransaction, trans2: ITransaction) => {
        await trans1.listFiles();
        await trans2.deleteFile('file1');
    })).toBe(false);
    // Both transactions can list.
    expect(await performDualTransaction(async (trans1: ITransaction, trans2: ITransaction) => {
        await trans1.listFiles();
        await trans2.listFiles();
    })).toBe(true);
    // Same transaction can write and list.
    expect(await performDualTransaction(async (trans1: ITransaction, trans2: ITransaction) => {
        await trans1.putFile('file1', "content", false);
        await trans1.listFiles();
    })).toBe(true);
    // Same transaction can list and write.
    expect(await performDualTransaction(async (trans1: ITransaction, trans2: ITransaction) => {
        await trans1.listFiles();
        await trans1.putFile('file1', "content", false);
    })).toBe(true);


    // Ensure transactions perform rollback on abort,
    // and apply on commit
    const mSource4 = new MockFileSource();
    const tSource3 = new TransactionFileSource(mSource4);

    await tSource3.transact(async (trans) => {
        await trans.putFile('file1', "content1", false);
    });

    expect(await mSource4.getFile('file1', false)).toBe("content1");

    try {
        await tSource3.transact(async (trans) => {
            await trans.putFile('file1', "content2", false);
            throw new Error("Opse!");
        });
    }
    catch(err) {
        // Opse!
    }
    expect(await mSource4.getFile('file1', false)).toBe("content1");    
});
    