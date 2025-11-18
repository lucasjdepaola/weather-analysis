import * as c from "csv-parse"
import * as fs from "node:fs"

// enumerated dataset for data from the csv file
type DatasetInsertion = {
    state: string;
    county: string;
    ZIP: number;
    YYYYMM: number;
    'precipitation(mm)': number;
    'tempMax(C)': number;
    'tempMin(C)': number;
    'tempAvg(C)': number;
}
// to clean the dataset to ideal variable names
type CleanedDatasetInsertion = {
    state: string;
    county: string;
    zip: number;
    yyyymm: number;
    precipitation: number;
    tempMaxF: number;
    tempMinF: number;
    tempAvgF: number;
}

// celsius to farenheit basic calculation
const cToFTemp = (tempC: number) => (tempC * 1.8) + 32;

// obtain the dataset using csvparse, casting to a custom type
const getDataset = async<DatasetType>(path: string): Promise<DatasetType[]> => {
    const dataset = fs.readFileSync(path, {encoding: "utf8"}) // read csv
    const arr: DatasetType[] = await c.parse(dataset, {
        columns: true,
        cast: true,
        delimiter: ","
    }).toArray(); // parse and convert to array
    return arr;
}

// custom unique filter since there's no other option
const filterUnique = <E>(arr: E[], fn: (e: E, i: number, a: E[]) => string): E[] => {
    const elements: E[] = []
    const keySet = new Set<string>();
    for(let i = 0; i < arr.length; i++) {
        // if it's in the set, don't add it
        const result: string = fn(arr[i], i, arr);
        if(!keySet.has(result)) {
            elements.push(arr[i]); // push the element
            keySet.add(result); // add to cache to show it's already added to the array
        }
    }
    return elements;
}

// cleaning the dataset
const cleanedDataset = async(): Promise<CleanedDatasetInsertion[]> => {
    let d = await getDataset<DatasetInsertion>("./data/202308.csv") // get dataset
    d = filterUnique(d, (e => `${e.state}-${e.county}`)) // make county unique via custom implementation
    return d.map(insertion => ({ // transform data to ideal variables such as farenheit, lowercase
        county: insertion.county,
        precipitation: insertion["precipitation(mm)"],
        state: insertion.state,
        tempAvgF: cToFTemp(insertion["tempAvg(C)"]),
        tempMaxF: cToFTemp(insertion["tempMax(C)"]),
        tempMinF: cToFTemp(insertion["tempMin(C)"]),
        yyyymm: insertion.YYYYMM,
        zip: insertion.ZIP
    }))
}

type Preciplevel = "High" | "Medium" | "Low";
type Config = {
    idealTempF: number;
    idealPrecipitation: Preciplevel // for simplicity bring it down to three categories
    idealAvgTempFluctuation: number; // filter outside of this range
    idealMinMaxFluctuation: number; // score based on this
}
const precipMapping = {
    Low: 0, // lowest precip
    Medium: 94, // average precip
    High: 300 // quasi-highest precip

} as const satisfies Record<Preciplevel, number>
const getIdealTemp = async(config: Config): Promise<CleanedDatasetInsertion[]> => {
    let dataset = await cleanedDataset()
    const idealCities: CleanedDatasetInsertion[] = dataset.filter(insertion =>  {
        // get ideal temp based on ideal fluctuations
        const low: number = config.idealTempF - config.idealAvgTempFluctuation;
        const high: number = config.idealTempF + config.idealAvgTempFluctuation;
        const minMaxSatisfies = (insertion.tempMaxF - insertion.tempMinF) < config.idealMinMaxFluctuation;
        return insertion.tempAvgF >= low && insertion.tempAvgF <= high && minMaxSatisfies;
    })
    console.log(dataset.length + " vs " + idealCities.length)
    return idealCities.sort((a, b) => {
        // lowest to highest is a - b
        const calculateScore = (insertion: CleanedDatasetInsertion): number => {
            const idealAverageScore = Math.abs(config.idealTempF - insertion.tempAvgF);
            const idealFluctuation = insertion.tempMaxF - insertion.tempMinF;
            const precipScore = Math.abs(precipMapping[config.idealPrecipitation] - insertion.precipitation)
            return idealAverageScore + idealFluctuation + precipScore // total score should be low
        }
        return calculateScore(a) - calculateScore(b);
    })
    // sort by significance with custom score
}
const main = async() => {
    let dataset = await cleanedDataset()
    // console.log("rain metrics are");
    // console.log(rainMetrics(dataset)); // I wanted this to check what levels are low, med, high for rain
    const cities = await getIdealTemp({
        idealPrecipitation: "Low",
        idealTempF: 70,
        idealAvgTempFluctuation:5, // more or less than 5
        idealMinMaxFluctuation: 20
    })
    console.log(`your ideal city:`)
    console.log(cities[0])
    console.log("similar to our ideal city");
    console.log(findSimilarOutOfState(cities[0], dataset));
}

// rain metrics to determine the "low", "med", and "high" rain categories
const rainMetrics = (data: CleanedDatasetInsertion[]): {min: number, max: number, avg: number} => {
    const sum = data.reduce<number>((p, c) => p + c.precipitation, 0);
    return {
        // min: keep the lowest value
        min: data.reduce((p, c) => c.precipitation < p.precipitation ? c : p).precipitation,
        // max: keep the highest value
        max: data.reduce((p, c) => c.precipitation > p.precipitation ? c : p).precipitation,
        // avg: aggregate the sum and divide by length
        avg: sum / data.length
    }
}

// main();


// for building relationships with data aside from the personal analysis
const buildCSV = () => {
    // build a csv for something
}

const findSimilarOutOfState = (to: CleanedDatasetInsertion, data: CleanedDatasetInsertion[]) => {
    // find a similar weather city (hopefully p value < .05) which is also out of state
    const state = to.state;
    const dataOutState = data.filter(insertion => insertion.state !== state);
    const getScore = (ins: CleanedDatasetInsertion) => {
        const precip = Math.abs(ins.precipitation - to.precipitation);
        const maxmin = Math.abs(ins.tempMaxF - to.tempMaxF) + Math.abs(ins.tempMinF - to.tempMinF);
        const avg = Math.abs(ins.tempAvgF - to.tempAvgF);
        return precip + maxmin + avg;
    }
    const sorted = dataOutState.sort((a, b) => getScore(a) - getScore(b)); // lowest score
    return sorted[0]; // lowest score with potential to give more data
}

interface StateWeather {
    [state: string]: CleanedDatasetInsertion[]
}
const groupByState = (data: CleanedDatasetInsertion[]): StateWeather =>
    data.reduce<StateWeather>((p, c) => ({
        ...p,
        [c.state]: [...(p[c.state]||[]), c]
    }), {})
const abstractGroupBy = <E>(data: E[], fn: (v: E) => string): Record<string, E[]> => {
    const record: Record<string, E[]> = {};
    for(let i = 0; i < data.length; i++) {
        const str = fn(data[i]);
        record[str] = [...(record[str]||[]), data[i]];
    }
    return record;
}// groupby([1,2,3], (v: number) => v.toString()) -> {1: [1], 2: [2], 3: [3]}
const easyGroupBy = <E>(data: E[], fn: (v: E) => string): Record<string, E[]> =>
    data.reduce<Record<string, E[]>>((p, c) => ({
        ...p,
        [fn(c)]: [...(p[fn(c)] || []), c],
    }), {});
// easyGroupBy([1,2,3], (v) => v.toString()); // 
// grouping all states by weather and accumulating a dataset
const gatherStateInfo = async() => {
    const dt = await cleanedDataset()
    const abstractGrouped = abstractGroupBy(dt, (v) => v.state);
    const grouped = groupByState(dt);
    console.log(grouped["NY"]);
    console.log(abstractGrouped["NY"])
    // lets try NY vs california
    const ny = grouped["NY"].map(i => i.tempAvgF);
    const cali = grouped["CA"].map(i => i.tempAvgF);
    // to remake the csv just do
    console.log(ny.length)
    console.log(cali.length)
    let str = "ny, ca\n";
    for(let i = 0; i < Math.min(ny.length, cali.length); i++) {
        str += `${ny[i]}, ${cali[i]}\n`;
    }
    fs.writeFileSync("./data/nycali.csv", str);
    // we'd have to zip it somehow

}
gatherStateInfo()
// lets build a csv that has different metrics, like state -> avg_weather

const jsonToCSV = <RowType>(json: RowType[][]): string => {
    // now we'd have to do this
    // array of array
    for(let i = 0; i < json.length; i++) {
        // iterate over cols of rows
    }
    json.map(row => {
        // extends an object probably
    })
    return "idk"
}