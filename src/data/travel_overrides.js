/**
 * Travel Overrides
 * Forces a specific detour when the direct path is blocked by collision or logic.
 */
const TRAVEL_OVERRIDES = [
    {
        // Scenario: Ithan (Town Side) -> Wioska Gnolli (Blocked by Wall)
        // Detour: Must go through Jaskinia Łowców
        fromMap: "Ithan",
        targetMap: "Wioska Gnolli",
        
        // If we didn't come from the 'Forest Side' exit (Jaskinia p.2),
        // we assume we are on the 'Town Side' and must take the detour.
        requiredLastMap: "Jaskinia Łowców p.2",
        
        // Force bot to go here instead of directly to Wioska Gnolli
        redirect: "Jaskinia Łowców p.1"
    },
    {
        // Scenario: Inside Jaskinia p.1 -> trying to go to Gnolle
        // Normal pathfinder might say "Go back to Ithan" if it thinks it's shorter?
        // Let's ensure flow: p.1 -> p.2
        fromMap: "Jaskinia Łowców p.1",
        targetMap: "Wioska Gnolli",
        redirect: "Jaskinia Łowców p.2"
    },
    {
        // Scenario: Inside Jaskinia p.2 -> into Ithan (Forest Side)
        fromMap: "Jaskinia Łowców p.2",
        targetMap: "Wioska Gnolli",
        redirect: "Ithan"
    },
    // Same logic for Bazyliszki (Pieczara Szaleńców is in Wioska Gnolli/Las Tropicieli direction)
    {
        fromMap: "Ithan",
        targetMap: "Las Tropicieli", // For Bazyliszki
        requiredLastMap: "Jaskinia Łowców p.2",
        redirect: "Jaskinia Łowców p.1"
    }
];

module.exports = TRAVEL_OVERRIDES;
