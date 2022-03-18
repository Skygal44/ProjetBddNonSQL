const {MongoClient} = require("mongodb");
const uri = "mongodb+srv://angela:1234@location.juee0.mongodb.net/location?retryWrites=true&w=majority";
const client = new MongoClient(uri);

async function Delete() {
    try {
        await client.connect();
        await deleteByname(client, "Bodo");
    } catch (error) {
        console.log(error)

    } finally {
        client.close()
    }
}

Delete().catch(console.dir);

async function deleteByname(client, option) {
    const res = await client.db("location").collection("personne").deleteOne({nom: option});
    console.log(res);
    console.log(`${res.deletedCount} document supprimés`);
}