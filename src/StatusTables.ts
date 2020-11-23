// import { randomInt } from "crypto";
// import { ChanceTime } from "./ChanceTime";
// import { IPrivMessageDetail } from "./IrcBot";
// import { TwitchBot } from "./TwitchBot";

// export class StatusTable {
//     public readonly goodStatuses = new ChanceTime<(message: IPrivMessageDetail) => void>();
//     public readonly midStatuses = new ChanceTime<(message: IPrivMessageDetail) => void>();
//     public readonly badStatuses = new ChanceTime<(message: IPrivMessageDetail) => void>();

//     public constructor(protected readonly _chatbot: TwitchBot) {
//         const tables = this.getTables();
//     }


//     public getTables() {
//         const goodStatuses = new ChanceTime<(message: IPrivMessageDetail) => void>();
//         const midStatuses = new ChanceTime<(message: IPrivMessageDetail) => void>();
//         const badStatuses = new ChanceTime<(message: IPrivMessageDetail) => void>();

//         const statChances = new ChanceTime<Stat>();
//         statChances.add(100, stats.strength);
//         statChances.add(100, stats.dexterity);
//         statChances.add(100, stats.constitution);
//         statChances.add(100, stats.intelligence);
//         statChances.add(100, stats.wisdom);
//         statChances.add(100, stats.charisma);
//         statChances.add(10, stats.offense);
//         statChances.add(10, stats.defense);
//         statChances.add(10, stats.armor_class);
//         statChances.add(10, stats.accuracy);
//         statChances.add(10, stats.iq);
//         statChances.add(10, stats.wits);
//         statChances.add(10, stats.guts);
//         statChances.add(10, stats.luck);
//         statChances.add(10, stats.moxie);
//         statChances.add(10, stats.stache);

//         goodStatuses.add(30, (messageDetails: IPrivMessageDetail) => {
//             const ppRoll = randomInt(23) + 4;
//             this._chatbot.chat(messageDetails.recipient, `${messageDetails.username} restored ${ppRoll} PP!`);
//         });
//         goodStatuses.add(20, (messageDetails: IPrivMessageDetail) => {
//             const hpRoll = randomInt(25) * 2 + randomInt(5);
//             this._chatbot.chat(messageDetails.recipient, `${messageDetails.username} restored ${hpRoll} HP!`);
//         });
//         goodStatuses.add(20, (messageDetails: IPrivMessageDetail) => {
//             const stat = statChances.roll();
//             const verbRoll = randomInt(5);
//             const verb = verbRoll === 0 ? "went up"
//                 : verbRoll === 1 ? "increased"
//                 : verbRoll === 2 ? "rose"
//                 : verbRoll === 3 ? "improved"
//                 : "was bolstered";
//             const buffAmount = (randomInt(4) * 5) + 5;
//             this._chatbot.chat(messageDetails.recipient, `${messageDetails.username}'s ${stat} ${verb} by ${buffAmount}!`);
//         });

//         midStatuses.add(10, (messageDetails: IPrivMessageDetail) => {
//             this._chatbot.chat(messageDetails.recipient, `${messageDetails.username} started crying uncontrollably!`);
//         });
//         midStatuses.add(10, (messageDetails: IPrivMessageDetail) => {
//             this._chatbot.chat(messageDetails.recipient, `${messageDetails.username}'s body solidified!`);
//         });
//         midStatuses.add(10, (messageDetails: IPrivMessageDetail) => {
//             this._chatbot.chat(messageDetails.recipient, `${messageDetails.username} felt a little strange...`);
//         });
//         midStatuses.add(10, (messageDetails: IPrivMessageDetail) => {
//             this._chatbot.chat(messageDetails.recipient, `${messageDetails.username} became nauseous.`);
//         });
//         midStatuses.add(40, (messageDetails: IPrivMessageDetail) => {
//             const stat = statChances.roll();
//             const verbRoll = randomInt(5);
//             const verb = verbRoll === 0 ? "went down"
//                 : verbRoll === 1 ? "dropped"
//                 : verbRoll === 2 ? "decreased"
//                 : verbRoll === 3 ? "lessened"
//                 : "fell";
//             const reduction = (randomInt(4) * 5) + 5

//             this._chatbot.chat(messageDetails.recipient, `${messageDetails.username}'s ${stat} ${verb} by ${reduction}!`);
//         });
//         midStatuses.add(10, (messageDetails: IPrivMessageDetail) => {
//             const hpRoll = randomInt(22) * 2 + randomInt(13);
//             this._chatbot.chat(messageDetails.recipient, `${messageDetails.username} was badly burned! They're hurt by the burn! (lost ${hpRoll} HP!)`);
//         });
//         midStatuses.add(10, (messageDetails: IPrivMessageDetail) => {
//             this._chatbot.chat(messageDetails.recipient, `${messageDetails.username} felt a little nauseous and can no longer use items to heal!`);
//         });

//         badStatuses.add(10, (messageDetails: IPrivMessageDetail) => {
//             const saveTable = [
//                 {
//                     stat: stats.strength,
//                     outcomes: [
//                         { severity: 0, text: ", falling prone and feeling humiliated" },
//                         { severity: 7, text: ". getting shoved off the cliff" },
//                     ]
//                 },
//                 {
//                     stat: stats.dexterity,
//                     outcomes: [
//                         ""
//                     ]
//                 },
//                 {
//                     stat: stats.constitution,
//                     outcomes: [
//                         ""
//                     ]
//                 },
//                 {
//                     stat: stats.intelligence,
//                     outcomes: [
//                         ""
//                     ]
//                 },
//                 {
//                     stat: stats.wisdom,
//                     outcomes: [
//                         ""
//                     ]
//                 },
//                 {
//                     stat: stats.charisma,
//                     outcomes: [
//                         ""
//                     ]
//                 }
//             ];

//             const statRoll = randomInt(6);
//             const statEntry = saveTable[statRoll];
//             const outcomeRoll = randomInt(statEntry.outcomes.length);
//             const statOutcome = statEntry.outcomes[outcomeRoll];
//             this._chatbot.chat(messageDetails.recipient, `${messageDetails.username} failed their ${statEntry.stat}${statOutcome}`);
//         });

//         return {
//             goodStatuses,
//             midStatuses,
//             badStatuses,
//         };
//     }
// }