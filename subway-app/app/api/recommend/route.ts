import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

interface Station {
  station: string;
  line: string;
  directions: Record<string, string>;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const start = searchParams.get('start')?.trim();
  const end = searchParams.get('end')?.trim();

  if (!start || !end) {
    return NextResponse.json(
      { error: 'Both start and end stations are required.' },
      { status: 400 }
    );
  }

  const filePath = join(process.cwd(), 'data', 'stations.json');
  const stations: Station[] = JSON.parse(readFileSync(filePath, 'utf-8'));

  const startStation = stations.find(
    (s) => s.station.toLowerCase() === start.toLowerCase()
  );

  if (!startStation) {
    return NextResponse.json({ error: 'No data available yet' });
  }

  const matchedKey = Object.keys(startStation.directions).find(
    (k) => k.toLowerCase() === end.toLowerCase()
  );

  if (!matchedKey) {
    return NextResponse.json({ error: 'No data available yet' });
  }

  const position = startStation.directions[matchedKey];
  const [car, door] = position.split('-');

  return NextResponse.json({
    line: startStation.line,
    recommended_position: position,
    reason: `Board Car ${car}, Door ${door}. This minimizes walking distance to the exit and transfer path at ${matchedKey} station.`,
  });
}
