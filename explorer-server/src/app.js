// Copyright 2019 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

const express = require('express');
const cors = require('cors');
const apicache = require('apicache');
const dbConnect = require('./db');

const app = express();
const cache = apicache.middleware;
const metaDB = process.env.METADATABASE;
const knex = dbConnect();
const dbEpochCache = {
    'missingdateofbirth': [],
    'missingdateofdeath': [],
    'missingplaceofbirth': [],
    'catfacts': []
}

app.use(express.json());
app.use(cors());

app.get('/', (req, res) => {
    res.send({
        message: 'Will return you wikiloop datasets.'
    })
});

// Get dataset list
app.get('/dslist', cache('5 minutes'), async (req, res) => {
    try {
        var datasetlist = await knex.withSchema(metaDB).from('datasetname').select('name');
    } catch (error) {
        console.error(error)
        res.status(404).send({ message: 'Database unreachable. Please try again later.' });
    }
    datasetlist = datasetlist.map(v => v.name);
    res.send(datasetlist);
})

app.get('/ds/:dsname/:epoch?', cache('5 minutes'), async (req, res, next) => {
    // if epoch not provided
    if (!req.params.epoch) {
        let dsname = req.params.dsname;
        existingEpochs = await getDsEpoch(dsname);
        if (existingEpochs.length === 0) {
            res.status(404).send({ message: 'No record for this dataset!' })
            return;
        }
        let epoch = existingEpochs[0];
        try {
            var data = await knex(dsname + '_' + epoch)
                .withSchema(dsname)
                .select('*');
        } catch (error) {
            console.error('Dataset fetch failed!')
            res.status(404).send({ message: 'Database unreachable. Please try again later.' });
        }
        res.send(data);
    }
    // otherwise pass the control to the next middleware function in this stack
    else next()
}, async (req, res, next) => {
    let dsname = req.params.dsname;
    let epoch = req.params.epoch;
    existingEpochs = await getDsEpoch(dsname);
    if (existingEpochs.length === 0 || !existingEpochs.includes(epoch)) {
        res.status(404).send({ message: 'No record for this dataset!' })
        return;
    }
    try {
        var data = await knex(dsname + '_' + epoch)
            .withSchema(dsname)
            .select('*');
    } catch (error) {
        console.error('Dataset fetch failed!')
        res.status(404).send({ message: 'Database unreachable. Please try again later.' });
    }
    res.send(data);
})

// Get dataset epoch list
app.get('/dsepoch/:dsname', cache('5 minutes'), async (req, res) => {
    let dsname = req.params.dsname;
    let epochs = await getDsEpoch(dsname);
    if (epochs.length === 0) {
        res.status(404).send({ message: 'No record for this dataset!' });
        return;
    }
    res.send(epochs);
});

// Get request for dataset stats
app.get('/dsstats/:dsname', cache('5 minutes'), async (req, res) => {
    let dsname = req.params.dsname;
    existingEpochs = await getDsEpoch(dsname);
    if (existingEpochs.length === 0) {
        res.status(404).send({ message: 'No record for this dataset!' })
        return;
    }
    if (req.query.epoch) {
        var epoch = req.query.epoch
        if (!existingEpochs.includes(epoch)) {
            res.status(404).send({ message: 'Invalid epoch!' })
            return;
        }
    } else {
        // If no epoch provided, return the newest one.        
        epoch = existingEpochs[0];
    }
    try {
        var data = await knex('updatecount_stats')
            .withSchema(dsname)
            .where('epoch', epoch)
            .select('*')
            .orderBy('addedtime', 'desc')
            .limit(1);
    } catch (error) {
        console.error('Dataset fetch failed!')
        res.status(404).send({ message: 'Database unreachable. Please try again later.' });
    }
    res.send(data);
})

// Get accumulate edits by day
app.get('/gamelogs/accumulateedits/:dsname/:epoch', cache('5 minutes'), async (req, res) => {
    let dsname = req.params.dsname;
    let epoch = req.params.epoch;
    try {
        let editsByDay = knex(dsname + '_' + epoch + '_logging')
            .withSchema(dsname)
            .select(knex.raw('date(changetime) as date, count(*) as num'))
            .groupBy('date')
        console.log(editsByDay.toString());
        var data = await knex.select(knex.raw('T3.date, sum(T3.num) as accumulate_edits'))
            .from(knex.raw('(select T1.date as date, T2.num as num from (' + editsByDay.toString() + ') as T1 cross join (' +
                editsByDay.toString() + ') as T2 where T1.date >= T2.date order by T1.date) as T3'))
            .groupByRaw('T3.date')
    } catch (error) {
        console.error(error + '\nDataset fetch failed!')
        res.status(404).send({ message: 'Database unreachable. Please try again later.' });
    }
    res.send(data);
})   

// Get editor decision distribution
app.get('/gamelogs/decisions/:dsname/:epoch', cache('5 minutes'), async (req, res) => {
    let dsname = req.params.dsname;
    let epoch = req.params.epoch;
    try {
        var data = await knex(dsname + '_' + epoch + '_logging')
            .withSchema(dsname)
            .select('decision', knex.raw('count(*) as num'))
            .groupBy('decision')
    } catch (error) {
        console.error(error + '\nDataset fetch failed!')
        res.status(404).send({ message: 'Database unreachable. Please try again later.' });
    }
    res.send(data);
}) 

//Get request for dataset leaderboard
app.get('/dsleaderboard/:dsname', cache('5 minutes'), async (req, res) => {
    let dsname = req.params.dsname;
    existingEpochs = await getDsEpoch(dsname);
    if (existingEpochs.length === 0) {
        res.status(404).send({ message: 'No record for this dataset!' })
        return;
    }
    if (req.query.epoch) {
        var epoch = req.query.epoch
        if (!existingEpochs.includes(epoch)) {
            res.status(404).send({ message: 'Invalid epoch!' })
            return;
        }
    } else {
        epoch = existingEpochs[0];
    }
    try {
        let tbname = dsname + '_' + epoch + '_logging';
        var users = await knex(tbname)
            .withSchema(dsname)
            .select('user', knex.raw('count(*) as num'))
            .groupBy('user')
            .orderBy('num', 'desc')
    } catch (err) {
        console.error(err);
        res.status(404).send({ message: 'Database unreachable. Please try again later.' });
        return;
    }
    res.send(users);
});

// Advanced search
app.post('/advancedsearch', async (req, res) => {
    let reqbody = req.body;
    if (reqbody.dsname.includes('missing')) {
        let result = await queryMissingValueDataset(reqbody);
        res.send(result);
    } else if (reqbody.dsname.includes('catfacts')) {
        //TODO
    }
});

async function queryMissingValueDataset(reqbody) {
    let epoch = reqbody.epoch;
    let dsname = reqbody.dsname;
    let epochList = await getDsEpoch(dsname);
    if (!epochList.includes(epoch)) {
        console.error('Dataset not found!');
        return [];
    }
    let itemList = reqbody.items.split(',');
    // Get all entity number (eg. 'Q123') from items list.
    let qItems = [];
    itemList.forEach(i => {
        i = i.trim();
        if (/^[Qq]\d+$/.test(i)) {
            qItems.push(i);
        }
    });
    if (reqbody.items.length !== 0 && qItems.length === 0) {
        console.error('Query items not valid');
        return [];
    }
    let langs = reqbody.languages;
    let table = dsname + '_' + epoch;
    let query = knex.withSchema(dsname).from(table).select();
    if (qItems.length !== 0) {
        query.whereIn('qNumber', qItems);
    }
    if (!langs.includes('all') && langs.length > 0) {
        query.where(function () {
            for (let lang of langs) {
                this.orWhere('languages', 'like', '%' + lang + '%');
            }
        });
    }
    return query;
}

// Get dataset epoch
async function getDsEpoch(dataset) {
    if (!dbEpochCache[dataset]) {
        return [];
    }
    if (dbEpochCache[dataset].length !== 0) {
        return dbEpochCache[dataset];
    }
    try {
        var epochs = await knex.withSchema(metaDB).from(dataset + 'epoch').select('epoch').orderBy('epoch', 'desc');
    } catch (error) {
        console.error(error)
        return [];
    }
    epochs = epochs.map(r => r.epoch);
    dbEpochCache[dataset] = epochs;
    return epochs;
}

// Start the server
const PORT = process.env.PORT || 8081;
app.listen(PORT, () => {
    console.log(`App listening on port ${PORT}`);
    console.log('Press Ctrl+C to quit.');
});