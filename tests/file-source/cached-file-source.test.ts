import FileSource from '../../src/file-source/file-source';
import CachedFileSource from '../../src/file-source/cached-file-source';
import MockFileSource from '../mock-file-source';


test("Test the cached file source", async () => {
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

    // Perform cached version.
    const mSource2 = new MockFileSource();
    await performOps(new CachedFileSource(mSource2));

    expect(mSource2.getFileCalls).toBe(1);
    expect(mSource2.putFileCalls).toBe(4);
    expect(mSource2.deleteFileCalls).toBe(2);
    expect(mSource2.listFilesCalls).toBe(1);

    // Perform cached + flush version.
    const mSource3 = new MockFileSource();
    const cachedFileSource = new CachedFileSource(mSource3, { autoFlushing: false });
    await performOps(cachedFileSource);

    // Before flushing
    expect(mSource3.getFileCalls).toBe(1);
    expect(mSource3.putFileCalls).toBe(0);
    expect(mSource3.deleteFileCalls).toBe(0);
    expect(mSource3.listFilesCalls).toBe(1);

    await cachedFileSource.flush();

    // After flushing
    expect(mSource3.getFileCalls).toBe(1);
    expect(mSource3.putFileCalls).toBe(1);
    expect(mSource3.deleteFileCalls).toBe(1);
    expect(mSource3.listFilesCalls).toBe(1);
});
    