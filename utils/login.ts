// import md5 from "js-md5";
import md5 from "./md5";
import {signLoginer} from '@/server/api';
// import { requestJSON } from "./url"

export function serverUrl() {
    // return 'http://java.3ddcim.com/v1'
    return '/api'
}

export async function request({ url, method = 'GET', data }: { url: string; method?: string; data?: any }) {
    console.log("请求参数:", url, data)
    return fetch(
        `${serverUrl()}${url}`,
        {
            method: method,
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(data),
        }
    )
}

export async function requestJSON({ url, method = 'GET', data }: { url: string; method?: string; data?: any }) {
    return (await request({ url, method, data })).json()
}

export async function signLogin(data:any) {
    return requestJSON({
        url: "/v1/SignLogin",
        method: "post",
        data,
    });
}

export async function toCookiesSave() {
    let timestamp = Math.floor(new Date().getTime() / 1000);
    let params = timestamp + "_nijunwen_" + "e4daded24a4a2b0e57d70ab52790deba";
    let signature = md5(params);
	// let signature = params
    const data = {
        signature,
        timestamp,
        username: "nijunwen",
    };
    return signLoginer(data);
};
