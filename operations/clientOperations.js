const {MongoClient} = require("mongodb");
const ObjectId = require('mongodb').ObjectID;
const uri = "mongodb+srv://sorbonne:1234@location.2tudd.mongodb.net/myFirstDatabase?retryWrites=true&w=majority";
const client = new MongoClient(uri);
const utils = require("./../utils/utils");
const contrat = require("./../contratLocation/readContratLocation");
const createContrat = require("./../contratLocation/createContratLocation");
const vehicule = require("./../vehicule/updateVehicule");
const readVehicule = require("./../vehicule/readVehicule");
const penalite = require("./../penalite/createPenalite");
const personneMorale = require("./../personne/morale/readPersonneMorale");
const personnePhysique = require("./../personne/physique/readPersonnePhysique");

const TVA = 0.2;

async function main() {
    try {
        await client.connect();
        // await rendreVehicule(client, 2);
        // await louerVehicule(client, 1, "morale", 1, 1, 1);
        // await louerVehicule(client, 1, "physique", [1, 2, 4, 81, 141, 252], "2022/04/02", "2022/04/10", 3)
        await rendreVehicule(client, new ObjectId("62487e176b172aaf254ad46e"))
    } catch (error) {
        console.error(error);
    } finally {
        client.close();
    }
}

main().catch(console.dir);

async function rendreVehicule(client, idContrat) {
    let resContrat = await contrat.findById(idContrat);

    // console.log(res);
    let joursDeRetard = await joursDePenalite(idContrat);
    if (joursDeRetard !== 0) {
        let penaliteData = {
            sommePenalite: await calculerPenalite(resContrat, joursDeRetard),
            joursDeRetard: joursDeRetard,
            idContrat: idContrat
        };
        await penalite.createOnePenalite(client, penaliteData);
    }
}

async function changeVehiculeStatus(vehicules) {
    vehicules.forEach((idVehicule) => {
        vehicule.changeStatusVehicule(idVehicule);
    })
}

async function joursDePenalite(idContrat) {
    let res = await client.db("location").collection("contratLocation").findOne({
        "_id": idContrat,
        "dateFin": {"$lt": new Date().toISOString()}
    });
    // console.log(res);
    if (res !== null)
        return utils.getDaysDifferenceFromToday(res.dateFin);

    return 0;
}

//PENALITE = JOURS DE RETARD * TVA DU VEHICULE (pour chaque vehicule)
async function calculerPenalite(contrat, joursDeRetard) {
    const test = client.db('location').collection('contratLocation').aggregate([
        {
            '$match': {
                '_id': contrat._id
            }
        },

        {
            '$lookup': {
                from: "vehicule",
                localField: "vehicule.SUV",
                foreignField: "_id",
                as: "vehicules_loues1"
            },

        },
        {
            '$lookup': {
                from: "vehicule",
                localField: "vehicule.voiture",
                foreignField: "_id",
                as: "vehicules_loues2"
            },
        },
        {
            '$lookup': {
                from: "vehicule",
                localField: "vehicule.fourgonettes",
                foreignField: "_id",
                as: "vehicules_loues3"
            },

        },
        {
            '$project': {
                vehicules_loues: {
                    $concatArrays: ["$vehicules_loues1", "$vehicules_loues2", "$vehicules_loues3"]
                }
            }
        },
        {'$unwind': '$vehicules_loues'},
        //////////////////////////////////////////
        {
            '$group': {
                "_id": 0,
                'total': {
                    '$sum':
                        {'$multiply': ['$vehicules_loues.modele.prixJour', TVA, joursDeRetard]}     //20% TVA
                }
            }
        }
    ]);

    let res;
    for await(const doc of test) {
        res = doc.total;
    }
    return Math.floor(res);

}

//TODO: LOUERVEHICULE FUNCTION
async function louerVehicule(client, idPersonne, typePersonne, vehiculesId, dateDebut, dateFin, idAgence) {
    let checkContrat = await checkIfContratOk(client, idPersonne, typePersonne, vehiculesId, dateDebut, dateFin);
    if (checkContrat.status === "error")
        return checkContrat.message;

    let vehicules = {
        "SUV": [],
        "voiture": [],
        "fourgonettes": []
    };
    let vehiculesNonLoues = await getVehiculesNonLoue(client, vehiculesId);

    vehiculesNonLoues.forEach((res) => {
        if (res.modele.nom === "SUV") vehicules.SUV.push(res._id);
        if (res.modele.nom === "voiture") vehicules.voiture.push(res._id);
        if (res.modele.nom === "fourgonette") vehicules.fourgonettes.push(res._id);
    });

    let valeur = {
        dateDebut: new Date(dateDebut).toISOString(),
        dateFin: new Date(dateFin).toISOString(),
        dateContrat: new Date().toISOString(),
        personne: {
            idPersonne: idPersonne,
            typePersonne: typePersonne
        },
        agence: idAgence,
        vehicule: vehicules,
        clauseLocation: "Texte tres long"
    };

    await createContrat.createContratLocations(client, valeur);
    //
    await changeVehiculeStatus(vehicules.SUV);
    await changeVehiculeStatus(vehicules.voiture);
    await changeVehiculeStatus(vehicules.fourgonettes);

    return "Le contrat a ete cree"
}


async function checkIfContratOk(client, idPersonne, typePersonne, vehicules, dateDebut, dateFin) {
    let response = {
        "status": "error",
        "message": "",
    };

    if (typePersonne === "morale" && !(await personneMorale.checkIfPersonneExists(client, idPersonne))) {
        response.message = `Personne morale avec l'id ${idPersonne} n'existe pas`;
        return response;
    }

    if (typePersonne === "physique" && !(await personnePhysique.checkIfPersonneExists(client, idPersonne))) {
        response.message = `Personne physique avec l'id ${idPersonne} n'existe pas`;
        return response;
    }
    if ((await getVehiculesNonLoue(client, vehicules)).length === 0) {
        response.message = "Les vehicules n'existent pas ou ils ne sont pas disponibles.";
        return response;
    }
    if (new Date(dateDebut).toISOString() > new Date(dateFin).toISOString()) {
        response.message = "La date de fin ne peut pas être supérieure à la date de début."
        return response;
    }

    response.status = "success";
    response.message = "Le véhicule peut être loué.";

    console.log(response);
    return response;
}

async function getVehiculesNonLoue(client, vehicules) {
    let res = await readVehicule.getManyVehiculesById(client, vehicules);
    let nonLoues = [];
    res.forEach((vehicule) => {
        if (vehicule.etatVehicule === "non loue")
            nonLoues.push(vehicule);
    });
    return nonLoues;
}
