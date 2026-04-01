import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  onSnapshot,
  serverTimestamp,
  Timestamp,
  addDoc,
  increment,
  updateDoc,
  deleteDoc
} from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import { db, auth } from '../firebase';
import { ResumeData } from '../types';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export const saveUserResume = async (resumeData: ResumeData, isPublic: boolean = true, resumeId?: string) => {
  // If not authenticated, sign in anonymously to allow saving
  if (!auth.currentUser) {
    try {
      await signInAnonymously(auth);
    } catch (error) {
      console.error('Anonymous auth error:', error);
      throw new Error('Failed to authenticate for saving. Please check your connection.');
    }
  }
  
  const uid = auth.currentUser!.uid;
  const finalResumeId = resumeId || doc(collection(db, 'resumes')).id;
  const path = `resumes/${finalResumeId}`;
  
  try {
    let slug = '';
    
    // Check if we already have a slug for this resume
    if (resumeId) {
      const existingDoc = await getDoc(doc(db, 'resumes', resumeId));
      if (existingDoc.exists() && existingDoc.data().slug) {
        slug = existingDoc.data().slug;
      }
    }
    
    // Generate a new slug if not exists
    if (!slug) {
      const baseSlug = (resumeData.name || 'resume').toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
      slug = baseSlug + '-' + Math.random().toString(36).substring(2, 7);
    }
    
    await setDoc(doc(db, 'resumes', finalResumeId), {
      uid,
      data: resumeData,
      slug,
      isPublic,
      viewCount: increment(0), // Initialize or keep
      updatedAt: serverTimestamp()
    }, { merge: true });

    // Also update slug mapping
    await setDoc(doc(db, 'slugs', slug), {
      resumeId: finalResumeId
    });

    return { resumeId: finalResumeId, slug };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
};

export const trackView = async (resumeId: string) => {
  try {
    const viewRef = collection(db, 'resumes', resumeId, 'views');
    await addDoc(viewRef, {
      timestamp: serverTimestamp(),
      userAgent: navigator.userAgent,
      referrer: document.referrer
    });
    
    // Increment view count on the resume document
    await updateDoc(doc(db, 'resumes', resumeId), {
      viewCount: increment(1)
    });
  } catch (error) {
    console.error('Error tracking view:', error);
  }
};

export const getUserResumes = async () => {
  if (!auth.currentUser) return [];
  const q = query(collection(db, 'resumes'), where('uid', '==', auth.currentUser.uid));
  try {
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'resumes');
    return [];
  }
};

export const deleteResume = async (resumeId: string) => {
  if (!auth.currentUser) throw new Error('User not authenticated');
  const path = `resumes/${resumeId}`;
  try {
    const resumeDoc = await getDoc(doc(db, 'resumes', resumeId));
    if (resumeDoc.exists() && resumeDoc.data().slug) {
      await deleteDoc(doc(db, 'slugs', resumeDoc.data().slug));
    }
    await deleteDoc(doc(db, 'resumes', resumeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
};
export const getResumeBySlug = async (slug: string) => {
  const slugPath = `slugs/${slug}`;
  try {
    const slugDoc = await getDoc(doc(db, 'slugs', slug));
    if (!slugDoc.exists()) return null;
    
    const resumeId = slugDoc.data().resumeId;
    const resumeDoc = await getDoc(doc(db, 'resumes', resumeId));
    
    if (!resumeDoc.exists()) return null;
    
    const data = resumeDoc.data();
    // Track view asynchronously
    trackView(resumeId);
    
    return { ...data, id: resumeId };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, slugPath);
  }
};

export const syncUserResume = (callback: (data: any) => void) => {
  if (!auth.currentUser) return () => {};
  
  const uid = auth.currentUser.uid;
  const path = `resumes/${uid}`;
  
  return onSnapshot(doc(db, 'resumes', uid), (snapshot) => {
    if (snapshot.exists()) {
      callback(snapshot.data());
    }
  }, (error) => {
    handleFirestoreError(error, OperationType.GET, path);
  });
};
