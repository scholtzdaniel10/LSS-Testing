/// <reference types="vite/client" />

interface FileSystemHandle {
  kind: 'file' | 'directory';
  name: string;
}

interface FileSystemFileHandle extends FileSystemHandle {
  kind: 'file';
  getFile(): Promise<File>;
}

interface FileSystemDirectoryHandle extends FileSystemHandle {
  kind: 'directory';
  entries(): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>;
  getDirectoryHandle(name: string): Promise<FileSystemDirectoryHandle>;
}

interface Window {
  showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
}
