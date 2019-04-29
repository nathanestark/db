
export default interface Transaction {
    commit(): Promise<void>
    abort(): Promise<void>

    getFile(path: string, decrypt: boolean): Promise<string | null>
    putFile(path: string, content: string, encrypt: boolean): Promise<string>
    deleteFile(path: string) : Promise<void>
    listFiles(options?: { pathFilter?: string, callback?: (name: string) => boolean }): Promise<Array<string>>
    getFileUrl(path: string): Promise<string | null>
}