
export default interface FileSource {
    getFile(path: string, decrypt: boolean): Promise<string | null>
    putFile(path: string, content: string, encrypt: boolean): Promise<void>
    deleteFile(path: string) : Promise<void>
    listFiles(options?: { pathFilter?: string, callback?: (name: string) => boolean }): Promise<Array<string>>
    getFileUrl(path: string): Promise<string | null>
}