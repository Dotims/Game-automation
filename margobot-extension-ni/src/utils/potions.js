/**
 * Potions Module
 * Handles counting, detecting and buying healing potions
 */

(function() {
    'use strict';
    
    // Ensure MargonemAPI exists
    window.MargonemAPI = window.MargonemAPI || {};
    
    /**
     * Potion sellers configuration
     */
    const POTION_SELLERS = [
        { name: "Uzdrowicielka Emanilia", map: "Liściaste Rozstaje", x: 21, y: 51 },
        { name: "Mnich Seweryn", map: "Klasztor Różanitów - świątynia", x: 25, y: 8 },
        { name: "Uzdrowiciel Ypsli", map: "Mirvenis-Adur", x: 82, y: 7 },
        { name: "Jemenoss", map: "Mythar", x: 45, y: 13 },
        { name: "Kapłanka Hiada", map: "Thuzal", x: 52, y: 17 },
        { name: "Szalony Etrefan", map: "Eder", x: 56, y: 40 },
        { name: "Doktor Nad", map: "Nithal", x: 5, y: 48 },
        { name: "Uzdrowiciel Toramidamus", map: "Tuzmer", x: 26, y: 21 },
        { name: "Uzdrowicielka Halfinia", map: "Karka-han", x: 31, y: 38 },
        { name: "Wysoka kapłanka Gryfia", map: "Torneg", x: 79, y: 8 },
        { name: "Uzdrowicielka Makatara", map: "Ithan", x: 18, y: 15 },
        { name: "Uzdrowicielka Hiliko", map: "Werbin", x: 38, y: 16 }
    ];
    
    /**
     * Potions utility system
     */
    const potions = {
        
        /**
         * Get list of potion sellers
         */
        getPotionSellers: function() {
            return POTION_SELLERS;
        },
        
        /**
         * Get healing potions in inventory
         * @returns {Object} { count, totalHealing, potions[] }
         */
        getHealingPotions: function() {
            const engine = window.Engine;
            if (!engine || !engine.items) {
                console.log("[Potions] Błąd: Engine.items niedostępne");
                return { count: 0, totalHealing: 0, potions: [] };
            }

            // "g" = przedmioty w torbie (ground/bag)
            const bagItems = engine.items.fetchLocationItems("g");
            if (!bagItems || !bagItems.length) {
                console.log("[Potions] Torba jest pusta");
                return { count: 0, totalHealing: 0, potions: [] };
            }

            let totalCount = 0;
            let totalHealing = 0;
            const potionList = [];

            bagItems.forEach(item => {
                let healingValue = 0;
                let amount = 1;

                // Spróbuj pobrać wartość leczenia z _cachedStats
                if (item._cachedStats && item._cachedStats.leczy !== undefined) {
                    healingValue = parseInt(item._cachedStats.leczy, 10) || 0;
                    amount = parseInt(item._cachedStats.amount, 10) || 1;
                }
                // Jeśli nie ma _cachedStats, spróbuj z item.stat (string format)
                else if (item.stat && typeof item.stat === 'string' && item.stat.includes('leczy=')) {
                    const healMatch = item.stat.match(/leczy=(\d+)/);
                    const amountMatch = item.stat.match(/amount=(\d+)/);
                    if (healMatch) healingValue = parseInt(healMatch[1], 10) || 0;
                    if (amountMatch) amount = parseInt(amountMatch[1], 10) || 1;
                }

                if (healingValue > 0) {
                    totalCount += amount;
                    totalHealing += healingValue * amount;
                    potionList.push({
                        id: item.id,
                        name: item.name || "Nieznana mikstura",
                        healing: healingValue,
                        amount: amount,
                        icon: item.icon || null
                    });
                }
            });

            // Sortuj od najsilniejszych do najsłabszych
            potionList.sort((a, b) => b.healing - a.healing);

            const result = {
                count: totalCount,
                totalHealing: totalHealing,
                potions: potionList
            };

            // Wyświetl w konsoli
            console.log("=================================================");
            console.log("[Potions] MIKSTURY LECZĄCE W EKWIPUNKU");
            console.log("=================================================");
            console.log("[Potions] Łączna ilość mikstur:", totalCount);
            console.log("[Potions] Łączna wartość leczenia:", totalHealing, "HP");
            console.log("[Potions] Lista mikstur:");
            
            if (potionList.length === 0) {
                console.log("[Potions]   (brak mikstur leczących)");
            } else {
                potionList.forEach((p, i) => {
                    console.log(`[Potions]   ${i+1}. "${p.name}" - leczy: ${p.healing} HP, ilość: ${p.amount}`);
                });
            }
            
            console.log("=================================================");

            return result;
        },
        
        /**
         * Count healing items using policzLeczyPrzedmioty if available
         */
        countHealingItems: function() {
            if (typeof policzLeczyPrzedmioty === 'function') {
                return policzLeczyPrzedmioty();
            }
            return this.getHealingPotions().count;
        },
        
        /**
         * Auto-display potions when game loads
         */
        initAutoDisplay: function() {
            const checkInterval = setInterval(() => {
                if (window.Engine && window.Engine.items && window.Engine.hero && window.Engine.hero.d) {
                    clearInterval(checkInterval);
                    setTimeout(() => {
                        console.log("[Potions] Gra załadowana - sprawdzam mikstury leczące...");
                        this.getHealingPotions();
                    }, 2000);
                }
            }, 500);
            
            // Timeout after 60 seconds
            setTimeout(() => {
                clearInterval(checkInterval);
            }, 60000);
        }
    };
    
    // Assign to MargonemAPI
    window.MargonemAPI.potions = window.MargonemAPI.potions || {};
    Object.assign(window.MargonemAPI.potions, potions);
    
    // Also expose as direct method for backwards compatibility
    window.MargonemAPI.getHealingPotions = function() {
        return window.MargonemAPI.potions.getHealingPotions();
    };
    
    // Auto-display potions on load
    potions.initAutoDisplay();
    
    console.log('[Potions] ✅ Potions module loaded');
})();
