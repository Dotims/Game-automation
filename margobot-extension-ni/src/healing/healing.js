/**
 * MargoSzpont NI - Healing Module
 * System automatycznego leczenia
 * 
 * Zależności:
 * - window.MargonemAPI.state (state.js)
 * - window.Engine (Margonem API)
 */

(function() {
    'use strict';
    
    window.MargonemAPI = window.MargonemAPI || {};
    
    window.MargonemAPI.healingSystem = window.MargonemAPI.healingSystem || {};
    
    Object.assign(window.MargonemAPI.healingSystem, {
        interval_of_selling: true,
        
        init: function() {
            this.ensureInterval();
            this.initializeDeathMonitoring();
        },
        
        initializeDeathMonitoring: function() {
            const checkInterval = setInterval(() => {
                const engine = window.Engine;
                if (engine?.dead !== undefined) {
                    clearInterval(checkInterval);
                    let isDead = engine.dead;
                    
                    Object.defineProperty(engine, "dead", {
                        get() {
                            return isDead;
                        },
                        set(newValue) {
                            const wasRevived = isDead && !newValue;
                            isDead = newValue;
                            if (wasRevived && window.MargonemAPI.state.heal.healAfterDeath) {
                                setTimeout(() => {
                                    window.MargonemAPI.healingSystem.checkAndHeal();
                                }, 300);
                            }
                        },
                        configurable: true
                    });
                }
            }, 100);
        },
        
        ensureInterval: function() {
            const healState = window.MargonemAPI.state.heal;
            if (healState.monitoringInterval) {
                clearInterval(healState.monitoringInterval);
                healState.monitoringInterval = null;
            }
            healState.monitoringInterval = setInterval(() => {
                this.checkAndHeal();
            }, 1500);
            healState.isMonitoring = true;
        },
        
        startMonitoring: function() {
            const healState = window.MargonemAPI.state.heal;
            if (!healState.isMonitoring) {
                this.ensureInterval();
            }
            healState.active = true;
        },
        
        stopMonitoring: function() {
            const healState = window.MargonemAPI.state.heal;
            healState.active = false;
            healState.isMonitoring = false;
            if (healState.monitoringInterval) {
                clearInterval(healState.monitoringInterval);
                healState.monitoringInterval = null;
            }
        },
        
        checkAndHeal: function() {
            const healState = window.MargonemAPI.state.heal;
            if (!healState.active || window.MargonemAPI.state.isDead) {
                return;
            }
            
            const engine = window.Engine;
            if (!engine?.hero?.d) {
                return;
            }
            
            const currentHp = engine.hero.d.warrior_stats?.hp || 0;
            const maxHp = engine.hero.d.warrior_stats?.maxhp || 1;
            
            if (currentHp >= maxHp) {
                return;
            }
            
            const selectedItem = this.pickItem(currentHp, maxHp);
            if (selectedItem) {
                this.useItem(selectedItem);
                if (healState.notify) {
                    window.message("[AutoHeal] Used: " + selectedItem.name);
                }
            }
        },
        
        pickItem: function(currentHp, maxHp) {
            const healState = window.MargonemAPI.state.heal;
            const allItems = window.Engine?.items?.fetchLocationItems("g") || [];
            
            let validItems = allItems.filter(item => {
                const itemName = item.name?.toLowerCase() || "";
                const isIgnored = healState.ignoredItems.some(ignoredName => 
                    ignoredName.toLowerCase() === itemName
                );
                if (isIgnored) {
                    return false;
                }
                
                const itemRarity = item._cachedStats?.rarity;
                let rarityCode = "P";
                switch (itemRarity) {
                    case "legendary": rarityCode = "L"; break;
                    case "upgraded": rarityCode = "Ul"; break;
                    case "heroic": rarityCode = "H"; break;
                    case "unique": rarityCode = "U"; break;
                    case "common": rarityCode = "P"; break;
                }
                
                if (!healState.rarity.includes(rarityCode)) {
                    return false;
                }
                
                return true;
            });
            
            const potionItems = healState.usePotions 
                ? validItems.filter(item => 
                    item._cachedStats?.leczy && 
                    parseInt(item._cachedStats.leczy) >= healState.minPotionHealing
                ) 
                : [];
            
            const fullHealItems = healState.useFulls 
                ? validItems.filter(item => item._cachedStats?.fullheal) 
                : [];
            
            const percentHealItems = healState.usePercents 
                ? validItems.filter(item => item._cachedStats?.perheal) 
                : [];
            
            const hpMissing = maxHp - currentHp;
            const efficientPotions = potionItems.filter(item => 
                parseInt(item._cachedStats.leczy) <= hpMissing
            );
            
            let selectedItem;
            
            if (efficientPotions.length > 0) {
                selectedItem = efficientPotions.reduce((best, current) => {
                    const bestHealing = parseInt(best._cachedStats.leczy);
                    const currentHealing = parseInt(current._cachedStats.leczy);
                    return currentHealing < bestHealing ? current : best;
                });
            } else if (fullHealItems.length > 0) {
                selectedItem = fullHealItems.reduce((best, current) => {
                    const bestValue = parseInt(best._cachedStats.fullheal || "999999");
                    const currentValue = parseInt(current._cachedStats.fullheal || "999999");
                    return currentValue < bestValue ? current : best;
                });
            } else if (percentHealItems.length > 0) {
                selectedItem = percentHealItems.reduce((best, current) => {
                    const bestPercent = parseInt(best._cachedStats.perheal);
                    const currentPercent = parseInt(current._cachedStats.perheal);
                    return currentPercent > bestPercent ? current : best;
                });
            } else if (healState.healToFull && (currentHp / maxHp * 100) < healState.minHealHpPercent && potionItems.length > 0) {
                selectedItem = potionItems.reduce((best, current) => {
                    const bestHealing = parseInt(best._cachedStats.leczy);
                    const currentHealing = parseInt(current._cachedStats.leczy);
                    return currentHealing < bestHealing ? current : best;
                });
            }
            
            return selectedItem;
        },
        
        useItem: function(item) {
            if (!item || !item.id) {
                return;
            }
            const command = "moveitem&st=1&id=" + item.id;
            window._g(command, () => {
                setTimeout(() => this.checkAndHeal(), 300);
            });
        }
    });
    
    console.log('[Healing] ✅ Healing module loaded');
})();
