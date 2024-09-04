'use client'

import React, { useEffect, useRef, useState } from 'react'
import { initializeApp } from 'firebase/app'
import { getFirestore, collection, addDoc, onSnapshot, query, where, orderBy, doc, Timestamp, deleteDoc, getDocs } from 'firebase/firestore'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff } from 'lucide-react'
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
    chatroomId: string,                         // ID of the chatroom
    from: string,                               // User ID of the sender
    to: string,                                 // User ID of the receiver
    offer?: RTCSessionDescriptionInit,          // Offer data (if type is 'offer')
    answer?: RTCSessionDescriptionInit,         // Answer data (if type is 'answer')
    candidate?: RTCIceCandidateInit,            // ICE candidate data (if type is 'candidate')
    timestamp: Timestamp,     // Timestamp when the document was created
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
    const [callAccepted, setcallAccepted] = useState(false)


    const localVideoRef = useRef<HTMLVideoElement>(null)
    const remoteVideoRef = useRef<HTMLVideoElement>(null)
    const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
    const rtcPeerConnectionRef = useRef<RTCPeerConnection | null>(null)

    useEffect(() => {
        console.log("RTC already Initialized")

        if (!rtcPeerConnectionRef.current) {
            console.log("RTC Initialized")
            createPeerConnection();
        }
    }, [rtcPeerConnectionRef]);
    useEffect(() => {
        if (remoteVideoRef.current && remoteStream) {
            console.log("Remote stream added")
            remoteVideoRef.current.srcObject = remoteStream;
        }
    }, [remoteStream]);

    useEffect(() => {
        console.log('useEffect triggered: Setting up onSnapshot for calls collection.')

        // the query for calls table where chatroom id is this
        const q = query(
            collection(db, 'calls'),
            where('chatroomId', '==', chatroomId),
            orderBy('timestamp', 'desc')
        )

        /* code below detects changes in calls table amd new doc is added and its type is offer and its sent by someone to 
        currentuser ,the setincomingcall state to true
        if type of doc data = 'answer' | 'candidate' and doc is sent to current user then handle the message
        */
        const unsubscribe = onSnapshot(q, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'added') {
                    const data_ = change.doc.data()
                    const data = data_ as docDatafromFirestore
                    // // if (data.type != "candidate") {
                    // //     // console.log(data, `Received on snapshot -- ${data.type}`)
                    // // }
                    // // else {
                    // //     // console.log(`Received on snapshot -- ${data.type}`)

                    // // }
                    if (data.to == currentUserId) {
                        handleSignalFromFirebase(data as docDatafromFirestore)

                        if (data.type == 'offer') {
                            setIncomingCall(true)
                            console.log('Incoming call detected')
                        }
                    }

                }
            })
        })

        return () => unsubscribe()
    }, [chatroomId, currentUserId])

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
            } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
                endCall()
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
            const timeout = setTimeout(() => {
                if (!rtcPeerConnectionRef.current?.remoteDescription) {
                    console.log('No response to RTC offer within 10 seconds. Resetting call state.');
                    endCall()

                }
            }, 15000); // 10 seconds timeout

            // Clear the timeout if an answer is received before the timeout expires
            rtcPeerConnectionRef.current.oniceconnectionstatechange = () => {
                if (rtcPeerConnectionRef.current?.iceConnectionState === 'connected') {
                    clearTimeout(timeout);
                    console.log('Connection established. Timeout cleared.');
                }
            };
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
        setcallAccepted(true)
        console.log('Accepting incoming call.')

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
        } catch (error) {
            console.error('Error accepting call:', error)
        }
    }

    const handleSignalFromFirebase = async (message: docDatafromFirestore) => {


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

                await new Promise<void>((resolve) => {setTimeout(() =>resolve(), 10000)});

                // Wait for either the user to accept or the timeout
                if (!callAccepted) {
                    console.log(callAccepted,"Call not accepted")
                    // setcallAccepted(true)
                    // If the call wasn't accepted in time, reset the connection and states
                    endCall()
                    console.log("Call not accepted within 10 seconds. Connection reset.");
                }
                
                else if (callAccepted) {
                    // the local video and audio details are already in peerConnection
                    const answer = await rtcPeerConnectionRef.current.createAnswer()
                    await rtcPeerConnectionRef.current.setLocalDescription(answer)
                    console.log('Answer created and set as local description.')

                    sendSignalDocToFirebase('answer', answer)

                }
                break
            case 'answer':
                // Sets the answer as the remote description. its used in call sender client side when reciever accepts call
                await rtcPeerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(message.answer!))
                console.log('Answer received and set as remote description.')
                if (rtcPeerConnectionRef.current.getReceivers()) {
                    console.log("THIS MEANS THE ACCEPTER HAS PROPERLY SENT TRACKS")
                    const remoteStream = new MediaStream();
                    rtcPeerConnectionRef.current.getReceivers().forEach(receiver => {
                        if (receiver.track) {
                            remoteStream.addTrack(receiver.track)
                            console.log("We are in the endgame now, tracks are added", receiver.track)

                        }

                    })
                    setRemoteStream(remoteStream)
                    if (remoteVideoRef.current) {
                        remoteVideoRef.current.srcObject = remoteStream;
                    }
                }
                break
            case 'candidate':
                // set ice candidates of each other for successful peer connection
                await rtcPeerConnectionRef.current.addIceCandidate(new RTCIceCandidate(deserializeIceCandidate(message.candidate)))
                console.log('ICE candidate added to RTCPeerConnection:')
                break
        }
    }

    const sendSignalDocToFirebase = async (type: string, payload: any) => {
        // console.log('Sending signaling message to Firebase:', { type, payload })

        try {
            const sentDoc = await addDoc(collection(db, 'calls'), {
                chatroomId,
                from: currentUserId,
                to: otherId,
                type,
                [type]: payload,
                timestamp: new Date()
            })
            // console.log('Document created in Firebase:', sentDoc)

        } catch (error) {
            console.error('Error sending signaling message:', error)
        }
    }

    //? Below function is called if user hangs up or connection is broken
    const endCall = () => {
        console.log('Ending call.')

        // rtcPeerConnectionRef.current?.close()

        setIsInCall(false)
        setIncomingCall(false)
        setIsCalling(false)
        setCallStatus('ended')
        console.log('Call ended and states reset.')

        rtcPeerConnectionRef.current = null
        // if(localVideoRef.current?.srcObject) { localVideoRef.current?.srcObject = null}

        deleteCallsCollectionDocs()
    }

    //? used to mute and unmute video and audio by muting and unmuting audio and video stream tracks 
    const toggleMute = () => {
        setIsMuted((prev) => !prev)
        localVideoRef.current?.srcObject &&
            ((localVideoRef.current.srcObject as MediaStream).getAudioTracks()[0].enabled = !isMuted)
        console.log('Toggled mute. Current state:', !isMuted)
    }

    const toggleVideo = () => {
        setIsVideoOff((prev) => !prev)
        localVideoRef.current?.srcObject &&
            ((localVideoRef.current.srcObject as MediaStream).getVideoTracks()[0].enabled = !isVideoOff)
        console.log('Toggled video. Current state:', !isVideoOff)
    }
    const deleteCallsCollectionDocs = async () => {
        try {
            const callsCollection = collection(db, 'calls')
            const snapshot = await getDocs(callsCollection)

            // Loop through each document and delete it
            const deletePromises = snapshot.docs.map(docSnapshot => deleteDoc(doc(db, "calls", docSnapshot.id)))
            await Promise.all(deletePromises)

            console.log('All documents in "calls" collection have been deleted.')
        } catch (error) {
            console.error('Error deleting documents:', error)
        }
    }
    return (
        <>
            {(
                <div className={`${isInCall ? "fixed inset-0 bg-black bg-opacity-50  z-50" : "  opacity-20 -left-[100vw]"} 
                flex items-center justify-center`}>
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
                            <Button onClick={endCall} variant="destructive" className="rounded-full p-3">
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
                        <Button onClick={() => setIncomingCall(false)} variant="outline">
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