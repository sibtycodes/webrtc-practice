"use client";
import React, { useEffect, useState } from 'react';
import VideoCall from '@/components/ui/VideoCall';

type Props = {};

function Page({ }: Props) {

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [otherId, setOtherId] = useState<string | null>(null);


  useEffect(() => {
    let storedCurrentUserId = localStorage.getItem('currentUserId');
    let storedOtherId = localStorage.getItem('otherId');

    if (!storedCurrentUserId || !storedOtherId) {
      localStorage.setItem('currentUserId', 'd08e7451-9932-4f79-9a45-c8b1612e192f');
      localStorage.setItem('otherId', '7f28b8f8-3674-4f68-b8d2-ad44af877ba7');

      storedCurrentUserId = localStorage.getItem('currentUserId');
      storedOtherId = localStorage.getItem('otherId');

    }


    if (storedCurrentUserId) {
      setCurrentUserId(storedCurrentUserId);
    }

    if (storedOtherId) {
      setOtherId(storedOtherId);
    }
  }, []);

  // Check if IDs are available before rendering the VideoCall component
  if (!currentUserId || !otherId) {
    return <div>Loading...</div>; // or handle this case appropriately
  }

  return (
    <main className='min-h-screen'>
      <VideoCall
        chatroomId='8f207a29-c2d1-4902-808a-b9e8a98acdce'
        otherId={otherId}
        currentUserId={currentUserId}
      />
    </main>
  );
}

export default Page;
