import { createProject, type Project } from '../../../entities/project/index.ts'

type Library = { current: string; projects: Project[] }
let db: Promise<IDBDatabase> | undefined

function open() {
  db ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('websynth', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('library')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return db
}

export async function loadLibrary(): Promise<Library> {
  const database = await open()
  return new Promise((resolve, reject) => {
    const request = database.transaction('library').objectStore('library').get('state')
    request.onsuccess = () => {
      if (request.result) resolve(request.result)
      else {
        const first = createProject('Новый проект')
        resolve({ current: first.id, projects: [first] })
      }
    }
    request.onerror = () => reject(request.error)
  })
}

export async function saveLibrary(library: Library) {
  const database = await open()
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('library', 'readwrite')
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error)
    transaction.objectStore('library').put(library, 'state')
  })
}
