// Initialize the map
const map = L.map('map', {
    center: [20, 0],
    zoom: 2,
    minZoom: 2,
    maxZoom: 6,
    zoomControl: true,
    attributionControl: false
});

// NO tileLayer at all = pure black background!

// Load simplified world boundaries (purple outlines)
fetch('https://raw.githubusercontent.com/datasets/geo-boundaries-world-110m/master/countries.geojson')
    .then(response => response.json())
    .then(data => {
        L.geoJSON(data, {
            style: {
                color: '#800080',
                weight: 1,
                fill: false
            }
        }).addTo(map);
    })
    .catch(err => console.error('Failed to load world boundaries', err));

// Layer groups for filtering
const eventLayers = {
    environmental: L.layerGroup().addTo(map),
    natural: L.layerGroup().addTo(map)
};

// Load events from external file
fetch('/js/events.json')
    .then(response => response.json())
    .then(events => {
        plotEvents(events);
    })
    .catch(err => console.error('Failed to load event data', err));

// Create custom icons
const icons = {
    environmental: L.divIcon({
        html: '<i class="fas fa-skull-crossbones" style="color: aqua; font-size: 16px;"></i>',
        iconSize: [16, 16],
        className: 'custom-div-icon'
    }),
    natural: L.divIcon({
        html: '<i class="fas fa-bolt" style="color: orange; font-size: 16px;"></i>',
        iconSize: [16, 16],
        className: 'custom-div-icon'
    })
};

// Function to plot events
function plotEvents(events) {
    eventLayers.environmental.clearLayers();
    eventLayers.natural.clearLayers();

    events.forEach(event => {
        const marker = L.marker([event.lat, event.lon], {
            icon: icons[event.type] || icons.natural
        }).bindPopup(`<b>${event.title}</b><br>${event.location}<br>${event.date}<br><a href="${event.link}" target="_blank">Source</a>`);

        if (event.type === 'environmental') {
            marker.addTo(eventLayers.environmental);
        } else if (event.type === 'natural') {
            marker.addTo(eventLayers.natural);
        }
    });
}

// Filter toggles
document.getElementById('env-disasters').addEventListener('change', (e) => {
    if (e.target.checked) {
        map.addLayer(eventLayers.environmental);
    } else {
        map.removeLayer(eventLayers.environmental);
    }
});

document.getElementById('natural-events').addEventListener('change', (e) => {
    if (e.target.checked) {
        map.addLayer(eventLayers.natural);
    } else {
        map.removeLayer(eventLayers.natural);
    }
});

// Date range selection (placeholder for future)
document.getElementById('date-range').addEventListener('change', (e) => {
    const days = parseInt(e.target.value);
    console.log(`Date range changed to last ${days} days.`);
});
