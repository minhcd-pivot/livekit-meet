import { EgressClient, EncodedFileOutput, RoomServiceClient } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    const roomName = req.nextUrl.searchParams.get('roomName');

    /**
     * CAUTION:
     * for simplicity this implementation does not authenticate users and therefore allows anyone with knowledge of a roomName
     * to start/stop recordings for that room.
     * DO NOT USE THIS FOR PRODUCTION PURPOSES AS IS
     */

    if (roomName === null) {
      return new NextResponse('Missing roomName parameter', { status: 403 });
    }

    const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL } = process.env;

    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL) {
      return new NextResponse('Missing LiveKit credentials', { status: 500 });
    }

    const hostURL = new URL(LIVEKIT_URL);

    // Initialize EgressClient and RoomServiceClient
    const egressClient = new EgressClient(hostURL.origin, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    const roomClient = new RoomServiceClient(hostURL.origin, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

    // Check for existing egresses for the room
    const existingEgresses = await egressClient.listEgress({ roomName });
    if (existingEgresses.length > 0 && existingEgresses.some((e) => e.status < 2)) {
      return new NextResponse('Room or participants are already being recorded', { status: 409 });
    }

    // Start room composite egress
    const compositeFileOutput = new EncodedFileOutput({
      filepath: `/out/export/${new Date(Date.now()).toISOString()}-${roomName}-composite`,
    });

    await egressClient.startRoomCompositeEgress(
      roomName,
      {
        file: compositeFileOutput,
      },
      {
        layout: 'speaker', // Use speaker layout for composite recording
        audioOnly: true,
      },
    );

    // Fetch all participants in the room
    const participants = await roomClient.listParticipants(roomName);
    if (participants.length === 0) {
      return new NextResponse('No participants found, but room composite recording started', {
        status: 200,
      });
    }

    // Start an egress for each participant
    const egressPromises = participants.map(async (participant) => {
      const identity = participant.identity;
      if (!identity) {
        return; // Skip participants without an identity
      }

      const fileOutput = new EncodedFileOutput({
        filepath: `/out/export/${new Date(Date.now()).toISOString()}-${roomName}-${identity}`,
      });

      return egressClient.startParticipantEgress(
        roomName,
        identity,
        {
          file: fileOutput,
        },
        {
          screenShare: false,
        },
      );
    });

    // Wait for all participant egresses to start
    await Promise.all(egressPromises.filter((p) => p !== undefined));

    return new NextResponse('Started composite room and participant recordings', { status: 200 });
  } catch (error) {
    if (error instanceof Error) {
      return new NextResponse(error.message, { status: 500 });
    }
    return new NextResponse('An unknown error occurred', { status: 500 });
  }
}
