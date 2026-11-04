import type { DocumentData, QueryDocumentSnapshot, SnapshotOptions } from 'firebase/firestore'

// ドキュメントIDを id に入れ、保存するときは id を外す
export function converter<T extends { id: string }>() {
  return {
    toFirestore: ({ id: _id, ...rest }: T): DocumentData => rest,
    fromFirestore: (snap: QueryDocumentSnapshot, options?: SnapshotOptions): T => ({ id: snap.id, ...snap.data(options) }) as T,
  }
}
