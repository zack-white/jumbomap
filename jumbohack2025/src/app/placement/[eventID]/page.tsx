"use client";

import React, { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useRouter } from 'next/navigation';
import mapboxgl from "mapbox-gl";
import InfoPopup from "@/components/ClubInfo";
import { Switch } from "@/components/ui/switch"; 
import "./placement.css";
import "mapbox-gl/dist/mapbox-gl.css";

interface Club {
  id: number;
  name: string;
  description: string;
  category: string;
  coordinates?: {
    x: number;
    y: number;
  };
  x?: number;
  y?: number;
}

interface EmailSummary {
  total: number;
  successful: number;
  failed: number;
}

interface EmailResults {
  message?: string;
  summary?: EmailSummary;
}

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_KEY;

const INITIAL_LONG = -71.120;
const INITIAL_LAT = 42.4075;
const INITIAL_ZOOM = 17.33;

export default function MapboxMap() {
  const { eventID } = useParams<{ eventID: string }>();
  const id = eventID; 
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // For now this really only loads the proper map going from the create event to
  // the placement page -- later should fix
  const paramLong = searchParams.get('x') ? parseFloat(searchParams.get('x') || '') : INITIAL_LONG;
  const paramLat = searchParams.get('y') ? parseFloat(searchParams.get('y') || '') : INITIAL_LAT;
  const paramZoom = searchParams.get('scale') ? parseFloat(searchParams.get('scale') || '') : INITIAL_ZOOM;

  // Map container and map instance
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);

  // Initial position of map - now using URL parameters if available
  const [long, setLong] = useState(paramLong);
  const [lat, setLat] = useState(paramLat);
  const [zoom, setZoom] = useState(paramZoom);

  // Keep track of clubs to add to map
  const [unplacedClubs, setUnplacedClubs] = useState<Club[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [queue, setQueue] = useState<Club[]>([]);
  const [selectedClub, setSelectedClub] = useState<Club | null>(null);

  // Placement mode and moving mode on map
  const [placementMode, setPlacementMode] = useState(true);
  const [movingClub, setMovingClub] = useState<Club | null>(null);

  // Track club to show popup for
  const [clubInfo, setClubInfo] = useState<Club>();
  const [showClubInfo, setShowClubInfo] = useState(false);

  // Enhanced state for email sending
  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [emailResults, setEmailResults] = useState<EmailResults | null>(null);

  // On page render, create map and fetch all old clubs w/ for given event.

  // Track markers on the map; needed for refreshing the map
  const markersRef = useRef<mapboxgl.Marker[]>([]);

  // On page render, create map and fetch all old clubs for given event.
  useEffect(() => {
    if (!mapContainerRef.current) return;
  
    initializeMap();
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;

    mapRef.current.on("click", handleMapClick);

    return () => {
      if (mapRef.current) {
        mapRef.current.off("click", handleMapClick);
      }
    };
  }, [queue, placementMode, selectedClub]);

  // Updating cursor between view and placement mode
  useEffect(() => {
    if (!mapRef.current) return;
    
    if (placementMode) {
      mapRef.current.getCanvas().style.cursor = 'crosshair';
    } else {
      mapRef.current.getCanvas().style.cursor = '';
    }
  }, [placementMode]);

  // Update queue when category is selected or user wants to move a club
  useEffect(() => {
    if (selectedCategory) {
      // Filter clubs by category AND ensure they don't have coordinates
      const filteredClubs = unplacedClubs.filter(
        (club) => 
          club.category === selectedCategory && 
          (club.x === undefined || club.x === null) && 
          (club.y === undefined || club.y === null)
      );
      setQueue(filteredClubs);

      // Set selected club to club being moved if one exists; otherwise set to first in list
      if (movingClub) {
        // Put the club being moved at the front of the queue so user doesn't have to scroll in queue to find it
        const otherClubs = filteredClubs.filter(club => club.id !== movingClub.id);
        const reorderedClubs = [movingClub, ...otherClubs];
        setQueue(reorderedClubs);
        setSelectedClub(movingClub);
        setMovingClub(null);
      }
      else if (filteredClubs.length > 0) setSelectedClub(filteredClubs[0]);
    }
  }, [selectedCategory, unplacedClubs]);

  /* ------------FUNCTION DECLARATIONS------------ */

  const initializeMap = async () => {
    const updateMap = async () => {
      try {        
        const response = await fetch("/api/getEventLocation", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              eventID: id
            })
        });

        if (!response.ok) {
            console.error("Error fetching map location:", response.status);
            return;
        }

        const data = await response.json();

        if (data.location) {
          setLong(data.location.x);
          setLat(data.location.y);
        }
        if (data.scale) {
          setZoom(data.scale);
        }

        return data;
      } catch(error) {
        console.error("Error fetching map location:", error);
        return [];
      }
    };

    // Get updated coordinates first
    const locationData = await updateMap();
    
    // Use the fetched coordinates directly instead of using state
    let mapLong = long;
    let mapLat = lat;
    let mapZoom = zoom;
    
    if (locationData && locationData.location) {
      mapLong = locationData.location.x;
      mapLat = locationData.location.y;
      
      // Also update state for other components that might need it
      setLong(mapLong);
      setLat(mapLat);
    }
    
    if (locationData && locationData.scale) {
      mapZoom = locationData.scale;
      setZoom(mapZoom);
    }

    // Create map with directly fetched coordinates
    const map = new mapboxgl.Map({
      container: mapContainerRef.current!,
      style: "mapbox://styles/mapbox/standard",
      center: [mapLong, mapLat],
      zoom: mapZoom,
    });
    mapRef.current = map;

    // Make cursor a crosshair once map is mounted
    if (placementMode) {
      mapRef.current.getCanvas().style.cursor = 'crosshair';
    } else {
      mapRef.current.getCanvas().style.cursor = '';
    }

    map.on("load", async () => {
      const existingClubs = await getExistingClubs();
      existingClubs.forEach((club: Club) => {
          if (!club.coordinates) return; 

          const marker = new mapboxgl.Marker()
              .setLngLat([club.coordinates.x, club.coordinates.y])
              .addTo(map);
          
          // Track the marker
          markersRef.current.push(marker);

          marker.getElement().addEventListener("click", createMarkerClickHandler(marker));
      });
    });

    // Fetch clubs on page load
    setTimeout(() => {
      fetchClubs();
    }, 500);

    mapRef.current.on("move", () => {
      // Get the current center coordinates and zoom level from the map
      const mapCenter = map.getCenter();
      const mapZoom = map.getZoom();

      setLong(mapCenter.lng);
      setLat(mapCenter.lat);
      setZoom(mapZoom);
    });

    // Cleanup on unmount
    return () => map.remove();
  };

  // Fetch all unplaced clubs from db
  async function fetchClubs() {
    try {
      const eventIDFromParams = id;
      
      const response = await fetch("/api/getUnplacedClubs", {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventID: eventIDFromParams
          })
      });

      if (!response.ok) {
          console.error("Error fetching clubs:", response.status);
          return;
      }

      const data = await response.json();
      setUnplacedClubs(data);
      
      // Extract unique categories
      const uniqueCategories: string[] = Array.from(new Set<string>(data.map((club: Club) => club.category))) as string[];
      setCategories(uniqueCategories);

    } catch(error) {
      console.error("Error fetching clubs:", error);
    }
  };

  // Place club when user clicks on map as long as placement mode is on and there are clubs to place
  const handleMapClick = async (e: mapboxgl.MapMouseEvent) => {
    if (!placementMode || queue.length === 0) {
      return;
    }
    
    const { lng, lat } = e.lngLat;
    const marker = new mapboxgl.Marker() 
      .setLngLat([lng, lat])
      .addTo(mapRef.current!);
    
    // Track the new marker
    markersRef.current.push(marker);

    marker.getElement().addEventListener("click", createMarkerClickHandler(marker));

    await handlePlaceClub(lng, lat);
  };

  // Assign coordinates to the next club in the queue
  const handlePlaceClub = async (lng: number, lat: number) => {
    if (!selectedClub || queue.length === 0) return;
  
    // Send update request
    fetch('/api/updateClub', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'updateCoordinates',
        id: selectedClub.id,
        x: lng,
        y: lat,
      })
    }).then((response) => {
      if (!response.ok) {
        console.error('Failed to update club coordinates');
      }
    }).catch((error) => {
      console.error('Error updating club:', error);
    });
  
    // Remove the selected club from queue and select the next one
    setQueue((prevQueue) => {
      const newQueue = prevQueue.filter((club) => club.id !== selectedClub.id);
      // Set the new selected club to be the first in the updated queue
      setSelectedClub(newQueue.length > 0 ? newQueue[0] : null);
      return newQueue;
    });
  };

  // When club is clicked, show popup
  const createMarkerClickHandler = (marker: mapboxgl.Marker) => {
    return async (event: Event) => {
      event.stopPropagation();
  
      const { lng, lat } = marker.getLngLat();
      
      try {
        const response = await fetch("/api/getClubByCoords", {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'findByCoords',
            x: lng,
            y: lat
          })
        });
  
        if (response.ok) {
          const fetchedClub = await response.json();
          
          if (fetchedClub) {
            setClubInfo({
              id: fetchedClub.id,
              name: fetchedClub.name,
              description: fetchedClub.description,
              category: fetchedClub.category,
            });
            setShowClubInfo(true);
          }
        }
      } catch(error) {
        console.error("Error fetching club:", error);
      }
    };
  };

  // Fetch all existing clubs to add to map
  const getExistingClubs = async () => {
    try {        
        const response = await fetch("/api/getExistingClubs", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              eventID: id
            })
        });

        if (!response.ok) {
            console.error("Error fetching existing clubs:", response.status);
            return [];
        }

        const data = await response.json();
        return data;
    } catch(error) {
        console.error("Error fetching existing clubs:", error);
        return [];
    }
  }

  // Refresh markers on map; allows for moving clubs and showing popups w/out re-rendering
  const refreshMarkers = async () => {
    if (!mapRef.current) return;
  
    // Remove all existing markers
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];
  
    // Reload existing clubs and recreate markers
    const existingClubs = await getExistingClubs();
    existingClubs.forEach((club: Club) => {
      if (!club.coordinates) return;
  
      const marker = new mapboxgl.Marker()
        .setLngLat([club.coordinates.x, club.coordinates.y])
        .addTo(mapRef.current!);
  
      markersRef.current.push(marker);
  
    });
  };

  const handleAddTable = () => {
    router.push(`/addTable/${id}`)
  }

  const handleSubmit = async () => {
    await handleSave();
    handleClose();
  };

  const handleSave = async () => {
    setIsLoading(true);
    setStatus('Sending invitations...');
    setEmailResults(null);

    try {
      // console.log('Sending invitations for event:', id);
      
      const response = await fetch('/api/send-invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: parseInt(id as string, 10) }),
      });

      const data = await response.json();
      // console.log('Response data:', data);

      if (!response.ok) {
        throw new Error(data.message || `HTTP error! status: ${response.status}`);
      }

      setEmailResults(data);
      
      if (data.summary) {
        setStatus(
          `Invitations processed: ${data.summary.successful} sent successfully, ${data.summary.failed} failed`
        );
      } else {
        setStatus(data.message || 'Invitations sent successfully!');
      }
    } catch (error) {
      console.error('Error sending invitations:', error);
      setStatus(
        error instanceof Error 
          ? `Error: ${error.message}` 
          : 'Error sending invitations. Please check the console for details.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    router.push(`/eventview?id=${id}`);
  };

  // Edit club information
  const handleEditClub = async () => {
    router.push(`/editTable/${clubInfo?.id}`); // Navigate to edit page with club ID
  };

  // Move club marker
  const handleMoveClub = async () => {
    if (!clubInfo || !mapRef.current) return;

    setMovingClub(clubInfo);
  
    try {
      const response = await fetch('/api/updateClub', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'removeCoordinates',
          id: clubInfo.id,
        }),
      });
  
      if (!response.ok) {
        throw new Error('Failed to remove club coordinates');
      }
  
      // Refresh markers first
      await refreshMarkers();
      
      // Refetch unplaced clubs from database
      await fetchClubs();
  
      // Reset category to update queue
      setSelectedCategory(clubInfo.category);
  
      setShowClubInfo(false);
  
      //setMovingClub(null);
    } catch (error) {
      console.error('Error moving club:', error);
    }
  };

  return (
    <div className="wrapper">
      <div ref={mapContainerRef} className="mapContainer relative">
        <div className="absolute bottom-2 left-2 bg-white px-3 py-2 z-10 flex gap-2">
          <Switch 
            checked={placementMode}
            onCheckedChange={setPlacementMode}
          />
          <p>{placementMode ? "Placement Mode" : "View Mode"}</p>
        </div>
      </div>
      {showClubInfo && clubInfo !== undefined && 
        <InfoPopup 
          club={clubInfo} 
          onClose={() => setShowClubInfo(false)} 
          onEdit={handleEditClub}
          onMove={handleMoveClub}
        />
      }
      <div className="p-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col gap-4">
        <h1 className="text-2xl font-bold flex items-center">
          Unplaced Clubs
        </h1>

        {/* Category Dropdown */}
        <div className="flex flex-row justify-between sm:justify-start gap-4">
          <div className="w-3/5 bg-categoryBg border">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full h-full px-6 py-4 bg-categoryBg"
            >
              <option>Select a category</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>

          {/* Submit button (moves left when queue is empty) */}
          <div className={`queueAndSubmit flex-shrink-0 ${queue.length > 0 ? 'ml-4' : ''}`}>
            <button className="h-[6vh] px-6 mr-2 border border-[#2E73B5] bg-[#F7F9FB] text-[#2E73B5]" onClick={handleAddTable}>
              + Table
            </button>
            <button
              type="button"
              className="h-[6vh] px-6 mr-2 border border-[#2E73B5] bg-white text-[#2E73B5]"
              onClick={handleSave}
              disabled={isLoading}
            >
              {isLoading ? "Sending..." : "Save"}
            </button>
            <button 
              type="submit" 
              className="h-[6vh] px-6 bg-[#2E73B5] text-white" 
              onClick={handleSubmit}
              disabled={isLoading}
            >
              {isLoading ? "Processing..." : "Submit"}
            </button>
          </div>
        </div>
        
        {/* Queue */}
        <div className="flex flex-row overflow-auto items-center gap-[1vw]">
          {/* Queue container (conditionally hidden when empty) */}
          {queue.length > 0 && (
            <div className="flex-grow min-w-0">
              <ul className="flex flex-row overflow-x-auto no-scrollbar">
              {queue.map((club) => (
                <li 
                  key={club.id} 
                  className={`mr-2 border-b text-center cursor-pointer h-16 flex items-center justify-center px-4 whitespace-nowrap ${
                    club.id === selectedClub?.id 
                      ? 'bg-[#2E73B5] text-white' 
                      : 'bg-categoryBg hover:bg-gray-200'
                  }`}
                  onClick={() => setSelectedClub(club)}
                >
                  <span className="leading-tight">
                    {club.name}
                  </span>
                </li>
              ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      
      {/* Enhanced status display */}
      {status && (
        <div className="p-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className={`p-4 rounded-lg border ${
            status.includes('Error') 
              ? 'bg-red-50 border-red-200 text-red-800' 
              : 'bg-green-50 border-green-200 text-green-800'
          }`}>
            <p className="font-medium">{status}</p>
            
            {/* Show detailed results if available */}
            {emailResults && emailResults.summary && (
              <div className="mt-2 text-sm">
                <p>Total emails processed: {emailResults.summary.total}</p>
                <p>Successfully sent: {emailResults.summary.successful}</p>
                {emailResults.summary.failed > 0 && (
                  <p>Failed to send: {emailResults.summary.failed}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};