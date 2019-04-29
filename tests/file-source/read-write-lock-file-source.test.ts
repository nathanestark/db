import FileSource from '../../src/file-source/file-source';
import ReadWriteLockFileSource from '../../src/file-source/read-write-lock-file-source';
import MockFileSource from '../mock-file-source';


test("Test the read-write lock file source", async () => {
    // Perform directly on the mock.

    // Write/Read test.
    let source: FileSource = new MockFileSource([75, 50]);
    let results: any = await Promise.all([
        source.putFile("file1", "Some content", false),
        source.getFile("file1", false),
    ]);
    expect(results[1]).toBe(null);

    // Write/Write test.
    source = new MockFileSource([75, 50, 100]);
    results = await Promise.all([
        source.putFile("file1", "Some content 1", false),
        source.putFile("file1", "Some content 2", false),
        source.getFile("file1", false) 
    ]);
    expect(results[2]).toBe("Some content 1");

    // Delete/Read test.
    source = new MockFileSource([75, 50, 100]);
    results = await Promise.all([
        source.putFile("file1", "Some content 1", false),
        source.deleteFile("file1"),
        source.getFile("file1", false) 
    ]);
    expect(results[2]).toBe("Some content 1");

    // Write/GetUrl test.
    source = new MockFileSource([75, 50]);
    results = await Promise.all([
        source.putFile("file1", "Some content 1", false),
        source.getFileUrl("file1") 
    ]);
    expect(results[1]).toBe(null);
    

    // Now perform on the lock
    source = new ReadWriteLockFileSource(new MockFileSource([75, 50]));
    results = await Promise.all([
        source.putFile("file1", "Some content", false),
        source.getFile("file1", false),
    ]);
    expect(results[1]).toBe("Some content");

    // Write/Write test.
    source = new ReadWriteLockFileSource(new MockFileSource([75, 50, 100]));
    results = await Promise.all([
        source.putFile("file1", "Some content 1", false),
        source.putFile("file1", "Some content 2", false),
        source.getFile("file1", false) 
    ]);
    expect(results[2]).toBe("Some content 2");

    // Delete/Read test.
    source = new ReadWriteLockFileSource(new MockFileSource([75, 50, 100]));
    results = await Promise.all([
        source.putFile("file1", "Some content 1", false),
        source.deleteFile("file1"),
        source.getFile("file1", false) 
    ]);
    expect(results[2]).toBe(null);

    // Write/GetUrl test.
    source = new ReadWriteLockFileSource(new MockFileSource([75, 50]));
    results = await Promise.all([
        source.putFile("file1", "Some content 1", false),
        source.getFileUrl("file1") 
    ]);
    expect(results[1]).toBe(MockFileSource.DEFAULT_URL + "/file1");


    // Gets must wait test
    let mSource = new MockFileSource([75, 1,1,1,1]);
    source = new ReadWriteLockFileSource(mSource);
    let promises : Array<Promise<any>> = [
        source.putFile("file1", "Some content 1", false),
        source.getFile("file1", false),
        source.getFile("file1", false), 
        source.getFile("file1", false),
        source.getFile("file1", false)
    ];
    expect(mSource.putFileCalls).toBe(1);
    expect(mSource.getFileCalls).toBe(0);

    results = await Promise.all(promises);
    expect(mSource.putFileCalls).toBe(1);
    expect(mSource.getFileCalls).toBe(4);

    
    // Writes must wait for writes test
    mSource = new MockFileSource([75, 1,1,]);
    source = new ReadWriteLockFileSource(mSource);
    promises = [
        source.putFile("file1", "Some content 1", false),
        source.putFile("file1", "Some content 2", false),
        source.putFile("file1", "Some content 3", false),
    ];
    expect(mSource.putFileCalls).toBe(1);

    results = await Promise.all(promises);
    expect(mSource.putFileCalls).toBe(3);


    // Writes must wait for all reads test
    mSource = new MockFileSource([75,1]);
    source = new ReadWriteLockFileSource(mSource);
    promises = [
        source.getFile("file1", false),
        source.putFile("file1", "Some content 1", false),
    ];
    expect(mSource.putFileCalls).toBe(0);
    expect(mSource.getFileCalls).toBe(1);

    results = await Promise.all(promises);
    expect(mSource.putFileCalls).toBe(1);
    expect(mSource.getFileCalls).toBe(1);

    
    // Reads do not wait for reads
    mSource = new MockFileSource([75,1]);
    source = new ReadWriteLockFileSource(mSource);
    promises = [
        source.getFile("file1", false),
        source.getFile("file1", false),
    ];
    expect(mSource.getFileCalls).toBe(2);

    results = await Promise.all(promises);
    expect(mSource.getFileCalls).toBe(2);

    
    // Reads wait for deletes
    mSource = new MockFileSource([75,1]);
    source = new ReadWriteLockFileSource(mSource);
    promises = [
        source.deleteFile("file1"),
        source.getFile("file1", false),
    ];
    expect(mSource.deleteFileCalls).toBe(1);
    expect(mSource.getFileCalls).toBe(0);

    results = await Promise.all(promises);
    expect(mSource.deleteFileCalls).toBe(1);
    expect(mSource.getFileCalls).toBe(1);

    
    // Writes of different files can happen at the same time.
    mSource = new MockFileSource([75,1, 1]);
    source = new ReadWriteLockFileSource(mSource);
    promises = [
        source.putFile("file1", "Some content 1", false),
        source.putFile("file2", "abc123", false),
        source.putFile("file1", "Some content 2", false),
    ];
    expect(mSource.putFileCalls).toBe(2);

    results = await Promise.all(promises);
    expect(mSource.putFileCalls).toBe(3);
});
    