import { ChanceTime } from "./ChanceTime";
import { IChatWarriorUserDetail } from "./GhettoBotato";
import { Utils } from "./Utils";

export class ChatWarriorAttribute {
    public constructor(
        public readonly key: string,
        public readonly name: string,
        public value: number = 10) {
        }
}

export interface IChatWarriorAttributes {
    [key: string]: ChatWarriorAttribute;
    strength: ChatWarriorAttribute;
    dexterity: ChatWarriorAttribute;
    constitution: ChatWarriorAttribute;
    intelligence: ChatWarriorAttribute;
    wisdom: ChatWarriorAttribute;
    charisma: ChatWarriorAttribute;
}

export interface IChatWarriorFlavor {
    [key: string]: ChatWarriorAttribute
    iq: ChatWarriorAttribute;
    guts: ChatWarriorAttribute;
    luck: ChatWarriorAttribute;
    moxie: ChatWarriorAttribute;
    stache: ChatWarriorAttribute;
}

export interface IChatWarriorState {
    currentHp: number;
    level: number;
    // status: ???
    attributes: IChatWarriorAttributes;
    attributeLevelUpPercentages: { [key: string]: number };
    flavor: IChatWarriorFlavor;
    // flavorLevelUpPercentages: { [key: string]: number };
}

const initialAttributeShuffleSpread = new ChanceTime<number>([
    { weight: 1, value: -2 },
    { weight: 2, value: -1 },
    { weight: 2, value: 1 },
    { weight: 1, value: 2 },
]);

const initialFlavorShuffleSpread = new ChanceTime<number>([
    { weight: 2, value: 1 },
    { weight: 1, value: 2 },
    { weight: 1, value: 3 },
]);

const initialAttributeLevelUpWeight = new ChanceTime<number>([
    { weight: 3, value: 0.01 },
    { weight: 1, value: 0.03 },
    { weight: 2, value: 0.05 },
    { weight: 1, value: 0.07 },
]);

// const initialFlavorLevelUpWeight = [ // TODO: Do this every certain # of levels, instead of all the time
//     { weight: 3, value: 0.01 },
//     { weight: 1, value: 0.03 },
//     { weight: 2, value: 0.05 },
//     { weight: 1, value: 0.07 },
// ];

export class ChatWarrior {
    public get maxHp(): number { return 5 * this.state.level + 3 * this.state.attributes.constitution.value + this.state.attributes.strength.value; }
    public get secondsRequiredToLevelUp(): number { return Math.ceil(60 * (30 + this.state.level)); }
    public get statTotal(): number {
        return Object.keys(this.state.attributes).reduce<number>((prev, cur) => {
            return this.state.attributes[cur].value + prev;
        }, 0);
    }
    protected readonly userDetail: IChatWarriorUserDetail;
    public get state(): IChatWarriorState { return this.userDetail.chatWarriorState!; }

    public constructor(userDetail: IChatWarriorUserDetail) {
        if (!userDetail.chatWarriorState) {
            const stats: IChatWarriorAttributes = {
                strength: new ChatWarriorAttribute("strength", "strength", 10),
                dexterity: new ChatWarriorAttribute("dexterity", "dexterity", 10),
                constitution: new ChatWarriorAttribute("constitution", "constitution", 10),
                intelligence: new ChatWarriorAttribute("intelligence", "intelligence", 10),
                wisdom: new ChatWarriorAttribute("wisdom", "wisdom", 10),
                charisma: new ChatWarriorAttribute("charisma", "charisma", 10),
            }
    
            const maxStatShuffles = 20;
            let currentShuffles = 0;
            while (currentShuffles < maxStatShuffles) {
                const statToShuffle = Utils.pickOne(Object.keys(stats));
                const amountToShuffle = initialAttributeShuffleSpread.roll();
                if (stats[statToShuffle].value <= amountToShuffle) {
                    continue;
                }
                stats[statToShuffle].value += amountToShuffle;
                currentShuffles++;
            }
    
            const flavor: IChatWarriorFlavor = {
                iq: new ChatWarriorAttribute("iq", "iq", 1),
                guts: new ChatWarriorAttribute("guts", "guts", 1),
                luck: new ChatWarriorAttribute("luck", "luck", 1),
                moxie: new ChatWarriorAttribute("moxie", "moxie", 1),
                stache: new ChatWarriorAttribute("stache", "stache", 1),
            };
            
            const maxFlavorShuffles = 7;
            currentShuffles = 0;
            while (currentShuffles < maxFlavorShuffles) {
                const flavorToShuffle = Utils.pickOne(Object.keys(flavor));
                const amountToShuffle = initialFlavorShuffleSpread.roll();
                flavor[flavorToShuffle].value += amountToShuffle;
                currentShuffles++;
            }

            const statLevelUpWeight: { [key: string]: number } = {};
            Object.keys(stats).forEach(x => { statLevelUpWeight[x] = 0.6; });
            currentShuffles = 0;
            const maxStatLevelUpWeightShuffles = 50;
            while (currentShuffles < maxStatLevelUpWeightShuffles) {
                const statToAdd = Utils.pickOne(Object.keys(stats));
                const statToSubtract = Utils.pickOne(Object.keys(stats));
                if (statToAdd === statToSubtract) {
                    continue;
                }
                const amountToSwap = initialAttributeLevelUpWeight.roll();
                if (statLevelUpWeight[statToSubtract] <= amountToSwap || statLevelUpWeight[statToAdd] + amountToSwap >= 1) {
                    continue;
                }
                statLevelUpWeight[statToSubtract] - amountToSwap;
                statLevelUpWeight[statToAdd] + amountToSwap;
                currentShuffles++;
            }

            this.userDetail.chatWarriorState = {
                currentHp: 10,
                level: 1,
                attributes: stats,
                attributeLevelUpPercentages: statLevelUpWeight,
                flavor,
            }
        }

        this.userDetail = userDetail;
    }

    public setStat(statName: string, value: number): void {
        this.state.attributes[statName].value = value;
    }

    public addStat(statName: string, value: number): void {
        const existingValue = this.state.attributes[statName].value ?? 0
        this.setStat(statName, existingValue + value);
    }

    public levelUp(): void {
        this.state.level++;
        for (const statName of Object.keys(this.state.attributeLevelUpPercentages)) {
            const percentToLevelUp = this.state.attributeLevelUpPercentages[statName];
            const roll = Math.random();
            if (roll < percentToLevelUp) {
                this.state.attributes[statName].value++;
            }
        }
    }

    // /** @returns true if victorious, false if not. */
    // public fight(opponent: ChatWarrior): boolean {
    //     // INT + STR /2 == damage
    //     // DEX == accuracy vs. evasion, chance to go first
    //     // CON * 3 + STR == HP augment
    //     // INT + WIS / 2 == resistance to effects
    //     // WIS + CHA / 2 == efficienty to inflict effects
    //     // CHA + DEX / 2 == crit chance
    //     return false;
    // }

    public getStateJson(): string {
        return JSON.stringify(this.state);
    }
}