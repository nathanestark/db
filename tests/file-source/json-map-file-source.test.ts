import FileSource from '../../src/file-source/file-source';
import JSONMapFileSource from '../../src/file-source/json-map-file-source';
import CachedFileSource from '../../src/file-source/cached-file-source';
import MockFileSource from '../mock-file-source';


test("Test the json map file source", async () => {
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

    // Perform RA version.
    const mSource2 = new MockFileSource();
    await performOps(new JSONMapFileSource(new CachedFileSource(mSource2)));

    expect(mSource2.getFileCalls).toBe(1);
    expect(mSource2.putFileCalls).toBe(10); // More than default, because each change requires writing to master and to the file we save on.
    expect(mSource2.deleteFileCalls).toBe(0);  
    expect(mSource2.listFilesCalls).toBe(0); // List calls all read from the in-memory list read from the 'master' file.

    // Perform RA + flush version.
    const mSource3 = new MockFileSource();
    const cachedFileSource = new JSONMapFileSource(new CachedFileSource(mSource3, { autoFlushing: false }));
    await performOps(cachedFileSource);

    // Before flushing
    expect(mSource3.getFileCalls).toBe(1); // 1 get for the master. we don't 'get' any other files, since they're only being created now, and will be in memory for us. 
    expect(mSource3.putFileCalls).toBe(0);
    expect(mSource3.deleteFileCalls).toBe(0);
    expect(mSource3.listFilesCalls).toBe(0);

    await cachedFileSource.flush();

    // After flushing
    expect(mSource3.getFileCalls).toBe(1);
    expect(mSource3.putFileCalls).toBe(2); // 1 saves: 1 for the master, 1 for the only file we're saving.
    expect(mSource3.deleteFileCalls).toBe(0);
    expect(mSource3.listFilesCalls).toBe(0);

    // Make sure values are correct.
    const mSource4 = new MockFileSource();
    const cachedFileSource2 = new JSONMapFileSource(new CachedFileSource(mSource4, { autoFlushing: false }));
    await cachedFileSource2.putFile("file1", "The quick brown fox", false);
    let content = await cachedFileSource2.getFile("file1", false);
    expect(content).toBe("The quick brown fox");
    await cachedFileSource2.putFile("file2", "Brown bear, brown bear.", false);
    content = await cachedFileSource2.getFile("file2", false);
    expect(content).toBe("Brown bear, brown bear.");
    content = await cachedFileSource2.getFile("file1", false);
    expect(content).toBe("The quick brown fox");

    await cachedFileSource2.putFile("file1", "Cow jumps over the moon", false);
    content = await cachedFileSource2.getFile("file2", false);
    expect(content).toBe("Brown bear, brown bear.");
    content = await cachedFileSource2.getFile("file1", false);
    expect(content).toBe("Cow jumps over the moon");

    await cachedFileSource2.deleteFile("file2");
    content = await cachedFileSource2.getFile("file2", false);
    expect(content).toBe(null);
    content = await cachedFileSource2.getFile("file1", false);
    expect(content).toBe("Cow jumps over the moon");

    // Check that we can get a URL to the master file..
    const mSource5 = new MockFileSource();
    const cachedFileSource3 = new JSONMapFileSource(new CachedFileSource(mSource5, { autoFlushing: false }));
    
    const data1 = { name: "firstName", type: "text", data: "Nathan", publicKey: "whatever" };
    const data2 = { name: "lastName", type: "text", data: "Stark", publicKey: "whatever" };
    await cachedFileSource3.putFile("firstName", JSON.stringify(data1), false);
    await cachedFileSource3.putFile("lastName", JSON.stringify(data2), false);

    // Need to flush first!    
    try {
        await cachedFileSource3.getFileMapUrl("firstName");
        expect(1).toBe(0);
    } catch(e) {
        expect(1).toBe(1);
    }

    await cachedFileSource3.flush();
    const url1 = await cachedFileSource3.getFileMapUrl("firstName");
    const url2 = await cachedFileSource3.getFileMapUrl("firstName");
    expect(url1).toMatch(/https:\/\/mock\.filesource\.nil\/files\/.*/);
    expect(url1).toBe(url2);
    
});
    