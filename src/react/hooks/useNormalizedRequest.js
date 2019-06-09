import { useState, useMemo, useEffect, useContext, useRef } from 'react'
import wretch from 'wretch'
import { normaliz } from 'normaliz'

import { identity, defaultSerialize, defaultRootKey, normalizedOperations } from './tools'
import { HyperactivContext, SSRContext } from '../context/index'

export function useNormalizedRequest(url, {
    store,
    normalize,
    client = wretch(),
    skip = () => false,
    beforeRequest = identity,
    afterRequest = identity,
    rootKey = defaultRootKey,
    serialize = defaultSerialize,
    bodyType = 'json',
    policy = 'cache-first',
    ssr = true
}) {
    const contextValue = useContext(HyperactivContext)
    const ssrContext = ssr && useContext(SSRContext)
    store = contextValue && contextValue.store || store
    client = contextValue && contextValue.client || client

    const configuredClient = useMemo(() => beforeRequest(client.url(url)), [client, beforeRequest, url])
    const storeKey = useMemo(() => serialize('get', configuredClient._url), [configuredClient])
    if(!store[rootKey]) {
        store[rootKey] = {}
    }
    const storedMappings = store[rootKey][storeKey]

    const cacheLookup = policy !== 'network-only'

    const [ error, setError ] = useState(null)
    const [ loading, setLoading ] = useState(
        !cacheLookup ||
        !storedMappings
    )
    const [ networkData, setNetworkData ] = useState(null)
    const data =
        cacheLookup ?
            storedMappings &&
            normalizedOperations.read(storedMappings, store) :
            networkData

    const unmounted = useRef(false)
    useEffect(() => () => unmounted.current = false, [])
    const pendingRequests = useRef([])

    function refetch(noState) {
        if(!noState && !unmounted.current) {
            setLoading(true)
            setError(null)
            setNetworkData(null)
        }
        const promise = configuredClient
            .get()
            // eslint-disable-next-line no-unexpected-multiline
            [bodyType](body => afterRequest(body))
            .then(result => {
                const normalizedData = normaliz(result, normalize)
                store[rootKey][storeKey] = Object.entries(normalizedData).reduce((mappings, [ entity, dataById ]) => {
                    mappings[entity] = Object.keys(dataById)
                    return mappings
                }, {})
                normalizedOperations.write(normalizedData, store)
                const storeSlice = normalizedOperations.read(store[rootKey][storeKey], store)
                pendingRequests.current.splice(pendingRequests.current.indexOf(promise), 1)
                if(!unmounted.current && pendingRequests.current.length === 0) {
                    setNetworkData(storeSlice)
                    setLoading(false)
                }
                return storeSlice
            })
            .catch(error => {
                pendingRequests.current.splice(pendingRequests.current.indexOf(promise), 1)
                if(!unmounted.current && pendingRequests.current.length === 0) {
                    setError(error)
                    setLoading(false)
                }
                if(ssrContext)
                    throw error
            })

        pendingRequests.current.push(promise)
        if(ssrContext) {
            ssrContext.push(promise)
        }
        return promise
    }

    function checkAndRefetch(noState = false) {
        if(
            !skip() &&
            !error &&
            (policy !== 'cache-first' || !data)
        ) {
            refetch(noState)
        }
    }

    useEffect(function() {
        checkAndRefetch()
    }, [ storeKey, skip() ])

    if(ssrContext) {
        checkAndRefetch(true)
    }

    return skip() ? {
        data: null,
        error: null,
        loading: false,
        refetch
    } : {
        loading,
        data,
        error,
        refetch
    }
}
