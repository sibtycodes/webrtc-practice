'use client'

import React, { useEffect, useRef, useState } from 'react'
import { initializeApp } from 'firebase/app'
import { getFirestore, collection, addDoc, onSnapshot, query, where, orderBy, doc, Timestamp, deleteDoc, getDocs, updateDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff, AlertCircleIcon, CheckCheckIcon } from 'lucide-react'
import { db } from '@/lib/firebase'
// Convert RTCIceCandidate to a plain object
const serializeIceCandidate = (candidate: RTCIceCandidate): any => {
    return {
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
    };
};
// Convert plain object back to RTCIceCandidate
const deserializeIceCandidate = (data: any): RTCIceCandidate => {
    return new RTCIceCandidate({
        candidate: data.candidate,
        sdpMid: data.sdpMid,
        sdpMLineIndex: data.sdpMLineIndex,
    });
};

type docDatafromFirestore = {
    type: 'offer' | 'answer' | 'candidate', // Type of signaling message
    chatroomId?: string,                    // ID of the chatroom (optional)
    from?: string,                          // User ID of the sender (optional)
    to?: string,                            // User ID of the receiver (optional)
    offer?: RTCSessionDescriptionInit,      // Offer data (if type is 'offer')
    answer?: RTCSessionDescriptionInit,     // Answer data (if type is 'answer')
    candidate?: RTCIceCandidateInit,        // ICE candidate data (if type is 'candidate')
    timestamp?: Timestamp,                  // Timestamp when the document was created (optional)
    status?: 'declined' | 'ended'           // Call status (optional)
}
type Props = {
    chatroomId: string
    currentUserId: string
    otherId: string
}
export default function VideoCall({ chatroomId, currentUserId, otherId }: Props) {
    const [isInCall, setIsInCall] = useState(false)
    const [incomingCall, setIncomingCall] = useState(false)
    const [isCalling, setIsCalling] = useState(false)
    const [isMuted, setIsMuted] = useState(false)
    const [isVideoOff, setIsVideoOff] = useState(false)
    const [callStatus, setCallStatus] = useState<'connecting' | 'connected' | 'ended'>('connecting')
    // const [callAccepted, setcallAccepted] = useState(false)

    const [needToInitializePeerConnection, setNeedToInitializePeerConnection] = useState(false)
    const localVideoRef = useRef<HTMLVideoElement>(null)
    const remoteVideoRef = useRef<HTMLVideoElement>(null)
    const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
    const rtcPeerConnectionRef = useRef<RTCPeerConnection | null>(null)
    const [offerTimeoutId, setOfferTimeoutId] = useState<NodeJS.Timeout | null>(null);
    const [declined, setDeclined] = useState(false)
    const [callEnded, setCallEnded] = useState(false)
    const declinedRef = useRef(false);
    useEffect(() => {
        declinedRef.current = declined
    }, [declined])
    useEffect(() => {
        console.log("RTC already Initialized")

        if (!rtcPeerConnectionRef.current) {
            console.log("RTC Initialized")
            createPeerConnection();
        }
    }, [rtcPeerConnectionRef, needToInitializePeerConnection]);
    useEffect(() => {
        if (remoteVideoRef.current && remoteStream) {
            console.log("Remote stream added")
            remoteVideoRef.current.srcObject = remoteStream;
        }
    }, [remoteStream]);

    useEffect(() => {
        console.log('useEffect triggered: Setting up onSnapshot for calls document and subcollections.');

        const callDocRef = doc(db, 'calls', `call-${chatroomId}`);

        const unsubscribeMain = onSnapshot(callDocRef, (docSnapshot) => {
            if (docSnapshot.exists()) {
                const data = docSnapshot.data();
                if (data.status === 'declined' || data.status === 'ended') {
                    //only change the states if the other person ends the call or declines
                    if (data.statusfrom === otherId) {
                        console.log("Declined or ended by", data.statusfrom)
                        handleCallStatusChange(data.status)
                    }
                }
            }
        });

        const unsubscribeOffer = onSnapshot(collection(callDocRef, 'offerRequests'), (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'added' && change.doc.data().to === currentUserId) {
                    const data = change.doc.data();
                    handleSignalFromFirebase({ type: 'offer', offer: data.payload });
                }
            });
        });

        const unsubscribeAnswer = onSnapshot(collection(callDocRef, 'answerRequests'), (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'added' && change.doc.data().to === currentUserId) {
                    const data = change.doc.data();
                    handleSignalFromFirebase({ type: 'answer', answer: data.payload });
                }
            });
        });

        const unsubscribeICE = onSnapshot(collection(callDocRef, 'iceCandidates'), (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'added' && change.doc.data().to === currentUserId) {
                    const data = change.doc.data();
                    handleSignalFromFirebase({ type: 'candidate', candidate: data.payload });
                }
            });
        });

        return () => {
            unsubscribeMain();
            unsubscribeOffer();
            unsubscribeAnswer();
            unsubscribeICE();
        };
    }, [chatroomId, currentUserId]);

    const handleCallStatusChange = (status: 'declined' | 'ended') => {
        if (status == 'declined') {
            setDeclined(true)
            endCall()



        }
        else if (status == 'ended') {
            setCallEnded(true)
            endCall()



        }
    }


    //? Peer connection created and saved in peerConnection ref
    const createPeerConnection = () => {
        console.log('Creating new RTCPeerConnection.')

        // `This function is used in two places: call start and call accept , 
        /*
        In call start it configures the ice servers and establishes peer connection
        */
        const configuration: RTCConfiguration = {
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        }
        const pc = new RTCPeerConnection(configuration)

        /* when ice connection is made on rtc peer add it to doc firebase with type = "candidate"
        this signal will then be added to other user's peerConnection.current.addIcecandidate
        */
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                const serializedCandidate = serializeIceCandidate(event.candidate);
                sendSignalDocToFirebase('candidate', serializedCandidate)
                // console.log('ICE candidate generated:', event.candidate)
            }
        }

        /* On track function tracks the other user stream ,When remote stream is received it is added to remote
        vidreference */
        pc.ontrack = (event) => {
            console.log('Remote track received:', event.streams[0])
            if (event.streams[0]) {
                setRemoteStream(event.streams[0])
                console.log('Remote stream set to video element.')
                setIsInCall(true)
                setCallStatus('connected')
            }
        }

        // whenever the connection is changed it triggers, used to update states of call upon change of rtc peer connection 
        pc.onconnectionstatechange = () => {
            console.log('Connection state changed:', pc.connectionState)
            if (pc.connectionState === 'connected') {
                setCallStatus('connected')
            } else if (pc.connectionState == 'disconnected' || pc.connectionState == 'failed' || pc.connectionState == 'closed') {
                endCall()
                setCallStatus('ended')
                setIsInCall(false)
                setIncomingCall(false)
            }
        }

        // Sets the peerconnection created to current ref of peerConnection
        rtcPeerConnectionRef.current = pc

    }

    const startCall = async () => {
        if (!rtcPeerConnectionRef.current) {
            console.error('RTCPeerConnection not initialized.');
            return;
        }
        console.log('Starting call.')

        setIsCalling(true)


        try {

            // get video audio stream
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
            console.log('Local media stream acquired.', stream)

            // add the stream to rtc connection so that other user can get it 
            stream.getTracks().forEach((track) => rtcPeerConnectionRef.current?.addTrack(track, stream))
            console.log('Tracks added to RTCPeerConnection.')
            //moved is in call above so that component wilkl render before we add stream

            // set local video to local stream
            if (localVideoRef.current) {
                localVideoRef.current.srcObject = stream
                console.log('Local video stream set.')
            }
            setIsInCall(true)//?Experiemnt

            // create offer of rtc connection save it in local description
            const offer = await rtcPeerConnectionRef.current?.createOffer()
            await rtcPeerConnectionRef.current?.setLocalDescription(offer)
            console.log('RTC offer created and local description set.')

            // Document is created in firebase as offer 
            sendSignalDocToFirebase('offer', offer)

            setCallStatus('connecting')
            // Set a timeout to handle the case where there's no response to the offer
            // Increase timeout to 45 seconds
            const timeout = setTimeout(() => {
                if (!rtcPeerConnectionRef.current?.remoteDescription) {
                    console.log('No response to RTC offer within 25 seconds. Resetting call state.');
                    endCall(false, false, true);
                }
            }, 25000); // 45 seconds timeout

            // Clear the timeout if an answer is received
            // const answerReceived = new Promise<void>((resolve) => {
            //     if (!rtcPeerConnectionRef.current) {
            //         console.log("RTC Peer Connection not initialized")
            //     }
            //     else {
            //         //`if declined by other user
            //         if(declined){
            //             clearTimeout(timeout)
            //             resolve()
            //         }
            //         rtcPeerConnectionRef.current.oniceconnectionstatechange = () => {
            //             if (rtcPeerConnectionRef.current?.iceConnectionState === 'connected') {
            //                 clearTimeout(timeout);
            //                 console.log('Connection established. Timeout cleared.');
            //                 resolve();
            //             }
            //         };
            //     }

            // });
            const answerReceived = new Promise<void | string>((resolve) => {
                if (!rtcPeerConnectionRef.current) {
                    console.log("RTC Peer Connection not initialized");
                    resolve();
                } else {
                    const checkState = () => {
                        if (declinedRef.current) {
                            clearTimeout(timeout);
                            console.log('Call declined. Timeout cleared.');
                            resolve("declined");
                        } else if (rtcPeerConnectionRef.current?.iceConnectionState === 'connected') {
                            clearTimeout(timeout);
                            console.log('Connection established. Timeout cleared.');
                            resolve();
                        } else {
                            setTimeout(checkState, 500); // Check every 500ms
                        }
                    };
                    checkState();
                }
            });

            const result = await Promise.race([answerReceived, new Promise(resolve => setTimeout(resolve, 25000))]);
            // if (result === "declined") {
            //     // endCall(false,false,true);
            // }
        } catch (error) {
            console.error('Error starting call:', error)
            setIsCalling(false)
            setIsInCall(false)
        }
    }

    const acceptCall = async () => {
        if (!rtcPeerConnectionRef.current) {
            console.error('RTCPeerConnection not initialized.');
            return;
        }

        console.log('Accepting incoming call.')
        // Clear the offer timeout when the call is accepted
        if (offerTimeoutId) {
            clearTimeout(offerTimeoutId)
            setOfferTimeoutId(null)
        }

        setIncomingCall(false)


        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
            console.log('Local media stream acquired.', stream)

            stream.getTracks().forEach((track) => rtcPeerConnectionRef.current?.addTrack(track, stream))
            console.log('Tracks added to RTCPeerConnection.')

            if (localVideoRef.current) {

                localVideoRef.current.srcObject = stream
                console.log('Local video stream set.')
            }


            setIsInCall(true)
            setCallStatus('connecting')

            const answer = await rtcPeerConnectionRef.current.createAnswer();
            await rtcPeerConnectionRef.current.setLocalDescription(answer);
            console.log('Answer created and set as local description.');
            sendSignalDocToFirebase('answer', answer);


        } catch (error) {
            console.error('Error accepting call:', error)
        }
    }

    const handleSignalFromFirebase = async (message: Partial<docDatafromFirestore>) => {


        // `Its used on snapshots from firebase
        /* if event is received and their is no reference of rtc peer connection then return ,we wont be able to 
        handle messages if rtc is not initialized yet */
        if (!rtcPeerConnectionRef.current) return console.log("-----------RTC PEER IS NOT PRESENT -------------")
        console.log("Connection is present with offer type", message.type)
        switch (message.type) {
            // Receives an offer from sender, sets it as the remote description, creates an answer, and sends it back.
            case 'offer':
                await rtcPeerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(message.offer!))
                console.log('Offer received and set as remote description.')
                setIncomingCall(true)

                // Set a 25-second timeout when offer is received
                const timeoutId = setTimeout(() => {
                    if (rtcPeerConnectionRef.current?.connectionState !== 'connected') {
                        console.log('Connection not established within 25 seconds. Ending call.')
                        endCall()
                    }
                }, 22000)
                setOfferTimeoutId(timeoutId)

                break
            case 'answer':

                // Sets the answer as the remote description. its used in call sender client side when reciever accepts call
                await rtcPeerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(message.answer!))
                console.log('Answer received and set as remote description.')
                setCallStatus('connected');
                if (rtcPeerConnectionRef.current.getReceivers().length > 0) {
                    console.log("THIS MEANS THE ACCEPTER HAS PROPERLY SENT TRACKS")
                    const remoteStream = new MediaStream();
                    rtcPeerConnectionRef.current.getReceivers().forEach(receiver => {
                        if (receiver.track) {
                            remoteStream.addTrack(receiver.track)


                        }

                    })
                    setRemoteStream(remoteStream)
                    if (remoteVideoRef.current) {
                        console.log("Remote stream set to video element.")
                        remoteVideoRef.current.srcObject = remoteStream;
                    }
                }
                break
            case 'candidate':
                // set ice candidates of each other for successful peer connection
                try {
                    await rtcPeerConnectionRef.current.addIceCandidate(new RTCIceCandidate(deserializeIceCandidate(message.candidate)));
                    console.log('ICE candidate added to RTCPeerConnection');
                } catch (error) {
                    console.error('Error adding ICE candidate:', error);
                }
                break
            default:
                console.log("Unknown message type:", message.type)
        }
    }

    const sendSignalDocToFirebase = async (type: string, payload: any) => {
        try {
            const callDocRef = doc(db, 'calls', `call-${chatroomId}`);

            // Update main call document
            await setDoc(callDocRef, {
                lastUpdated: serverTimestamp(),
                from: currentUserId,
                to: otherId
            }, { merge: true });

            // Create or update subcollection based on signal type
            let subcollectionRef;
            if (type === 'offer') {
                subcollectionRef = collection(callDocRef, 'offerRequests');
            } else if (type === 'answer') {
                subcollectionRef = collection(callDocRef, 'answerRequests');
            } else if (type === 'candidate') {
                subcollectionRef = collection(callDocRef, 'iceCandidates');
            }

            if (subcollectionRef) {
                await addDoc(subcollectionRef, {
                    payload,
                    timestamp: serverTimestamp(),
                    from: currentUserId,
                    to: otherId
                });
            }

            console.log(`${type} signal sent to Firebase for chatroom ${chatroomId}`);
        } catch (error) {
            console.error('Error sending signaling message:', error);
        }
    }

    //? Below function is called if user hangs up or connection is broken
    const endCall = (declined: boolean = false, endedByIcon: boolean = false, missed: boolean = false) => {
        console.log('Ending call.')

        // Stop all tracks in the local stream
        if (localVideoRef.current && localVideoRef.current.srcObject instanceof MediaStream) {
            localVideoRef.current.srcObject.getTracks().forEach(track => track.stop());
            localVideoRef.current.srcObject = null;
        }

        // Stop all tracks in the remote stream
        if (remoteVideoRef.current && remoteVideoRef.current.srcObject instanceof MediaStream) {
            remoteVideoRef.current.srcObject.getTracks().forEach(track => track.stop());
            remoteVideoRef.current.srcObject = null;
        }


        if (declined) {
            updateCallStatus('declined')
        }
        else if (endedByIcon) {
            updateCallStatus('ended')
        }
        else if (missed) {
            updateCallStatus('missed')
        }

        // Clear the remote stream state
        setRemoteStream(null);

        // Reset all call-related states
        setIsInCall(false)
        setIncomingCall(false)
        setIsCalling(false)
        setCallStatus('ended')
        setIsMuted(false)
        setIsVideoOff(false)
        setCallEnded(false)
        setDeclined(false)

        console.log('Call ended and states reset.')

        // Close and nullify the RTCPeerConnection
        if (rtcPeerConnectionRef.current) {
            rtcPeerConnectionRef.current.close()
            rtcPeerConnectionRef.current = null
        }
        setTimeout(() => {
            //delete call document
            deleteCallDocument()
        },5000)
        setNeedToInitializePeerConnection(prev => !prev)

    }

    //? used to mute and unmute video and audio by muting and unmuting audio and video stream tracks 
    const toggleMute = () => {
        const state = isMuted //false
        setIsMuted((prev) => !prev)
        localVideoRef.current?.srcObject &&
            ((localVideoRef.current.srcObject as MediaStream).getAudioTracks()[0].enabled = state)
        console.log('Toggled mute. Current state:', !state)
    }

    const toggleVideo = () => {
        const state = isVideoOff
        setIsVideoOff((prev) => !prev)
        localVideoRef.current?.srcObject &&
            ((localVideoRef.current.srcObject as MediaStream).getVideoTracks()[0].enabled = state)
        console.log('Toggled video. Current state:', !state)
    }
    // const deleteCallsCollectionDocs = async () => {
    //     try {
    //         const callsCollection = collection(db, 'calls')
    //         const snapshot = await getDocs(callsCollection)

    //         // Loop through each document and delete it
    //         const deletePromises = snapshot.docs.map(docSnapshot => deleteDoc(doc(db, "calls", docSnapshot.id)))
    //         await Promise.all(deletePromises)

    //         console.log('All documents in "calls" collection have been deleted.')
    //     } catch (error) {
    //         console.error('Error deleting documents:', error)
    //     }
    // }

    const updateCallStatus = async (status: 'declined' | 'ended' | 'missed') => {
        try {
            const callDocRef = doc(db, 'calls', `call-${chatroomId}`);
            await setDoc(callDocRef, {
                status: status,
                statusfrom: currentUserId,
                statusto: otherId,
                missedBy: otherId,
                lastUpdated: serverTimestamp()
            }, { merge: true });
            console.log(`Call ${status} status updated in Firebase for chatroom ${chatroomId}`);
        } catch (error) {
            console.error('Error updating call status:', error);
        }
    }
    const deleteCallDocument = async () => {
        try {
            const callDocRef = doc(db, 'calls', `call-${chatroomId}`);
            await deleteDoc(callDocRef);
            console.log(`Call document deleted for chatroom ${chatroomId}`);
        } catch (error) {
            console.error('Error deleting call document:', error);
        }
    }

    return (
        <>
            {(
                <div className={`${isInCall ? "fixed inset-0 bg-black bg-opacity-50  z-50" : " -z-10 absolute  opacity-20 -left-[100vw]"} 
                flex items-center justify-center`}>
                    {
                        declined && <section className=' z-[60] absolute inset-0 bg-slate-200 bg-opacity-50 flex items-center justify-center'>
                            <AlertCircleIcon className='h-12 w-12 text-red-800' />
                            <h1 className='text-red-800 text-2xl font-bold'>Call Declined</h1>
                        </section>
                    }
                    {
                        callEnded && <section className=' z-[60] absolute inset-0 bg-slate-200 bg-opacity-50 flex items-center justify-center'>
                            <CheckCheckIcon className='h-12 w-12 text-green-800' />
                            <h1 className='text-green-800 text-2xl font-bold'>Call Ended</h1>
                        </section>
                    }
                    <div className="bg-white p-6 rounded-lg shadow-lg max-w-4xl w-full">
                        <div className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-4">
                            <div className="relative w-full sm:w-1/2">
                                <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-64 sm:h-80 object-cover rounded-lg" />
                                <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded">
                                    You
                                </div>
                            </div>
                            <div className="relative w-full sm:w-1/2">
                                {remoteStream ?
                                    <video
                                        autoPlay
                                        playsInline
                                        className="w-full h-64 sm:h-80 object-cover rounded-lg"
                                        ref={remoteVideoRef}
                                    /> :
                                    <div className={`absolute top-0 z-50 ${callStatus == "connected" && "hidden"} w-full h-64 sm:h-80 bg-gray-200 rounded-lg flex items-center justify-center`}>
                                        <p className="text-gray-500">{callStatus === 'connecting' ? 'Connecting...' : 'Call Ended'}</p>
                                    </div>

                                }



                                <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded">
                                    Other User
                                </div>
                            </div>
                        </div>
                        <div className="flex justify-center space-x-4 mt-6">
                            <Button onClick={toggleMute} variant="outline" className="rounded-full p-3">
                                {!isMuted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
                            </Button>
                            <Button onClick={toggleVideo} variant="outline" className="rounded-full p-3">
                                {!isVideoOff ? <VideoOff className="h-6 w-6" /> : <Video className="h-6 w-6" />}
                            </Button>
                            <Button variant="destructive" onClick={() => endCall(false, true)} className="rounded-full p-3">
                                <PhoneOff className="h-6 w-6" />
                            </Button>
                        </div>
                    </div>
                </div>
            )}
            <Dialog open={incomingCall} onOpenChange={(open) => !open && setIncomingCall(false)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Incoming Call</DialogTitle>
                        <DialogDescription>
                            You have an incoming call. Would you like to accept?
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex justify-end space-x-2">
                        <Button onClick={() => endCall(true)} variant="outline">
                            Decline
                        </Button>
                        <Button onClick={acceptCall}>Accept</Button>
                    </div>
                </DialogContent>
            </Dialog>
            <Button onClick={startCall} variant="outline" className="ml-2" disabled={isCalling || isInCall}>
                {isCalling ? <span>Calling...</span> : <Phone className="h-6 w-6" />}
            </Button>
        </>
    )
}